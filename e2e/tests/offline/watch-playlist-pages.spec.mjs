import { test, expect } from '../../helpers/app.mjs'
import { openPagedPlaylist, pagedPlaylistVideoId, waitForPlaylistPagesIdle } from '../../helpers/pagedPlaylist.mjs'

// A YouTube playlist of 300 videos in three pages, of which the watch view
// starts with the first. Later pages load only when something needs them.
const VIDEO_COUNT = 300

test.describe.configure({ timeout: 120_000 })

test.use({
  seed: {
    settings: {
      animationSpeed: 0,
      backendFallback: false,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

function scrollerState(scroller) {
  return scroller.evaluate(element => ({
    scrollTop: element.scrollTop,
    // Allow both roundings of scrollHeight at fractional UI scales, in device pixels.
    offsetValid: (element.scrollTop - Math.max(0, element.scrollHeight - element.clientHeight)) * devicePixelRatio <= 2,
  }))
}

test('scrolling to the end of the panel loads the next page without moving the visible videos', { tag: '@scale' }, async ({ app, page }) => {
  let releasePage
  const pageReleased = new Promise(resolve => { releasePage = resolve })
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, {
    videoCount: VIDEO_COUNT,
    beforePage: pageNumber => pageNumber === 2 ? pageReleased : undefined,
  })
  const scroller = panel.locator('.playlistItemsWrapper')
  const items = panel.locator('.playlistItem')
  await expect(items).toHaveCount(100)
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([])

  // Rows grow from placeholders as they come into view and can move the end
  // away again, so keep scrolling to the end until the panel asks for more.
  const scrollToEnd = () => scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => {
    if (requestedPages.length === 0) await scrollToEnd()
    return requestedPages
  }).toEqual([2])

  // The rows in view settle before the page arrives
  const firstRowInView = () => scroller.evaluate(element => {
    const viewport = element.getBoundingClientRect()
    const row = [...element.querySelectorAll(':scope > .playlistItem')]
      .find(item => item.getBoundingClientRect().bottom > viewport.top)
    return { videoId: row.dataset.videoId, top: row.getBoundingClientRect().top - viewport.top, scrollTop: element.scrollTop }
  })
  let settled
  await expect.poll(async () => {
    const previous = settled
    settled = await firstRowInView()
    return JSON.stringify(previous) === JSON.stringify(settled)
  }).toBe(true)

  releasePage()
  await expect(items).toHaveCount(200)
  await waitForPlaylistPagesIdle(watch)
  // One page moves the end far enough away
  expect(requestedPages).toEqual([2])
  const loaded = await firstRowInView()
  expect(loaded.videoId).toBe(settled.videoId)
  expect(Math.abs(loaded.top - settled.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(loaded.scrollTop - settled.scrollTop)).toBeLessThanOrEqual(1)
  expect((await scrollerState(scroller)).offsetValid).toBe(true)

  await expect.poll(async () => {
    if (requestedPages.length === 1) await scrollToEnd()
    return requestedPages
  }).toEqual([2, 3])
  await expect(items).toHaveCount(VIDEO_COUNT)
  await waitForPlaylistPagesIdle(watch)
  expect((await scrollerState(scroller)).offsetValid).toBe(true)

  // At the real end, scrolling requests nothing more
  await scrollToEnd()
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([2, 3])
  await expect(panel.getByText(/Unavailable videos are hidden/)).toHaveCount(0)
})

test('the progress bar counts unloaded videos and loads the video it selects', { tag: '@scale' }, async ({ app, page }) => {
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: VIDEO_COUNT })
  await expect(panel.locator('.playlistIndex label')).toHaveText(`1 / ${VIDEO_COUNT}`)
  const fill = await panel.locator('.playlistProgressBarFill').evaluate(element => element.style.width)
  expect(Number.parseFloat(fill)).toBeCloseTo(100 / VIDEO_COUNT, 5)

  const bar = panel.locator('.playlistProgressBar')
  const box = await bar.boundingBox()
  // 90% selects video 270, on the third page
  await bar.click({ position: { x: box.width * 0.9, y: box.height / 2 } })
  await expect(panel.locator('.playlistItem')).toHaveCount(VIDEO_COUNT)
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([2, 3])
  await expect(panel.locator('.playlistItem').nth(269)).toBeInViewport()
  await expect(panel.locator('.playlistIndex label')).toHaveText(`1 / ${VIDEO_COUNT}`)
})

test('reversing the playlist loads every page and starts from its last video', async ({ app, page }) => {
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: VIDEO_COUNT })
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([])

  await panel.getByRole('button', { name: 'Reverse Playlist', exact: true }).click()
  await expect(panel.locator('.playlistItem')).toHaveCount(VIDEO_COUNT)
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([2, 3])
  await expect(panel.locator('.playlistItem').first()).toHaveAttribute('data-video-id', pagedPlaylistVideoId(VIDEO_COUNT - 1, 0))
  await expect(panel.locator('.playlistIndex label')).toHaveText(`${VIDEO_COUNT} / ${VIDEO_COUNT}`)
})

test('shuffling the playlist loads every page and picks from all of them', async ({ app, page }) => {
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: VIDEO_COUNT })
  await waitForPlaylistPagesIdle(watch)

  await panel.getByRole('button', { name: 'Shuffle Playlist', exact: true }).click()
  await expect(panel.locator('.playlistItem')).toHaveCount(VIDEO_COUNT)
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([2, 3])
  // The shuffled order after the current video covers every other video
  await expect.poll(() => watch.evaluate(view => view.upcomingPlaylistVideos.length)).toBe(VIDEO_COUNT - 1)
  const upcoming = await watch.evaluate(view => view.upcomingPlaylistVideos.map(video => video.videoId))
  expect(new Set(upcoming).size).toBe(VIDEO_COUNT - 1)
  expect(upcoming).not.toContain(pagedPlaylistVideoId(0, 0))
  expect(upcoming.slice(0, 99).some(videoId => Number(videoId.slice(2)) >= 100)).toBe(true)
})

test('loop steps back from the first video to the last one once every page has loaded', async ({ app, page }) => {
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: VIDEO_COUNT })
  await waitForPlaylistPagesIdle(watch)
  const canPlayPrevious = () => watch.evaluate(view => view.playlistSkipAvailability.canPlayPrevious)
  expect(await canPlayPrevious()).toBe(false)

  await panel.getByRole('button', { name: 'Loop Playlist', exact: true }).click()
  await expect(panel.locator('.playlistItem')).toHaveCount(VIDEO_COUNT)
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([2, 3])
  await expect.poll(canPlayPrevious).toBe(true)

  await watch.evaluate(view => view.$refs.watchVideoPlaylist.playPreviousVideo())
  await expect(page).toHaveURL(new RegExp(`#/watch/${pagedPlaylistVideoId(VIDEO_COUNT - 1, 0)}\\?`))
})

test('a current video on a later page loads the pages up to it', async ({ app, page }) => {
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: VIDEO_COUNT, playableIndex: 150 })
  await expect(panel.locator('.playlistIndex label')).toHaveText(`151 / ${VIDEO_COUNT}`)
  await waitForPlaylistPagesIdle(watch)
  // Video 151 is within 50 videos of the second page's end, so the third loads too
  expect(requestedPages).toEqual([2, 3])
  await expect(panel.locator('.playlistItem').nth(150)).toBeInViewport()
  expect(await watch.evaluate(view => view.$refs.watchVideoPlaylist.nextVideo?.videoId)).toBe(pagedPlaylistVideoId(151, 150))
})

test('the last cached video plays next into the page loaded ahead of it', async ({ app, page }) => {
  const { watch, panel, requestedPages } = await openPagedPlaylist({ app, page }, { videoCount: VIDEO_COUNT, playableIndex: 99 })
  await expect(panel.locator('.playlistIndex label')).toHaveText(`100 / ${VIDEO_COUNT}`)
  await waitForPlaylistPagesIdle(watch)
  expect(requestedPages).toEqual([2])
  await expect.poll(() => watch.evaluate(view => view.playlistSkipAvailability.canPlayNext)).toBe(true)
  expect(await watch.evaluate(view => view.$refs.watchVideoPlaylist.isWaitingForNextVideo)).toBe(false)

  await watch.evaluate(view => view.$refs.watchVideoPlaylist.playNextVideo())
  await expect(page).toHaveURL(new RegExp(`#/watch/${pagedPlaylistVideoId(100, 99)}\\?`))
})
