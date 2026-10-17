import { test, expect, setWindowSize } from '../../helpers/app.mjs'

const VIDEO_COUNT = 150

test.use({
  seed: {
    settings: {
      playlistViewType: 'list',
      userPlaylistSortOrder: 'custom',
      generalAutoLoadMorePaginatedItemsEnabled: true,
    },
    playlists: [{
      _id: 'windowing',
      playlistName: 'Windowed playlist',
      protected: false,
      videos: Array.from({ length: VIDEO_COUNT }, (_, index) => ({
        videoId: `window${String(index).padStart(5, '0')}`,
        title: `${index % 10 === 0 ? 'Marked' : 'Windowed'} video ${index + 1}`,
        author: 'Playlist channel',
        authorId: 'UCplaylistchannel',
        lengthSeconds: 60,
        playlistItemId: `window-item-${index}`,
        type: 'video',
      })),
      lastUpdatedAt: Date.now(),
    }],
  },
})

const rowsOf = page => page.locator('.playlistItems > .playlistItem')

async function openPlaylist(page) {
  const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/playlist/windowing?playlistType=user', makeActive: false }))
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await expect(rowsOf(page).first()).toBeAttached()
}

const scrollRange = page => page.evaluate(() => document.documentElement.scrollHeight)

/** Visits every row, including later pages, so each mounts once and records its real height. */
async function scrollToEnd(page) {
  const viewportMounted = () => page.evaluate(() => [...document.querySelectorAll('.playlistItems > .playlistItem')]
    .filter(row => {
      const { top, bottom } = row.getBoundingClientRect()
      return bottom > 0 && top < window.innerHeight
    })
    .every(row => row.querySelector('.ft-list-video')))
  const atEnd = () => page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1)
  // Far fewer steps are needed; the cap fails fast if the end never settles.
  for (let step = 0; ; step++) {
    expect(step).toBeLessThan(200)
    await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    await expect.poll(viewportMounted).toBe(true)
    if (await atEnd() && await rowsOf(page).count() === VIDEO_COUNT) break
  }
  await expect(rowsOf(page).last().locator('.ft-list-video')).toBeVisible()
}

/** Jumps to the end, loading later pages, without visiting every row. */
async function jumpToEnd(page) {
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    return await rowsOf(page).count() === VIDEO_COUNT &&
      await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1)
  }).toBe(true)
  await expect(rowsOf(page).last().locator('.ft-list-video')).toBeVisible()
}

/** The page offset stays in range, the list reaches the viewport end and no visible row is blank. */
async function expectValidPageRange(page) {
  await expect.poll(() => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.playlistItems > .playlistItem')]
    const last = rows.at(-1)
    const maximum = document.documentElement.scrollHeight - window.innerHeight
    return {
      offsetValid: window.scrollY <= Math.max(0, maximum) + 1,
      noEmptySpace: window.scrollY === 0 || last.getBoundingClientRect().bottom >= window.innerHeight - last.offsetHeight,
      visibleRowsMounted: rows.every(row => {
        const { top, bottom } = row.getBoundingClientRect()
        return bottom <= 0 || top >= window.innerHeight || !!row.querySelector('.ft-list-video')
      }),
    }
  })).toEqual({ offsetValid: true, noEmptySpace: true, visibleRowsMounted: true })
}

test('releases distant playlist rows without changing the scroll range', { tag: '@scale' }, async ({ page }) => {
  await openPlaylist(page)
  const rows = rowsOf(page)
  await scrollToEnd(page)

  // Rows near the top were released to shells sized like the mounted rows.
  await expect(rows.first().locator('.ft-list-video')).toHaveCount(0)
  const range = await scrollRange(page)
  const scrollY = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(rows.first().locator('.ft-list-video')).toBeVisible()
  await expect(rows.last().locator('.ft-list-video')).toHaveCount(0)
  await expect.poll(async () => Math.abs(await scrollRange(page) - range)).toBeLessThanOrEqual(1)

  // Returning to the end restores the same offset without empty space.
  await page.evaluate(top => window.scrollTo(0, top), scrollY)
  await expect(rows.last().locator('.ft-list-video')).toBeVisible()
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - scrollY)).toBeLessThanOrEqual(1)
})

test('keeps a valid offset when searching, resizing or removing at the end of a windowed playlist', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await openPlaylist(page)
  const rows = rowsOf(page)

  // Searching replaces the rows with a short result list.
  await jumpToEnd(page)
  // Typing through fill() would scroll the field into view and leave the end.
  const search = page.getByRole('searchbox', { name: 'Search for videos', exact: true })
  const type = text => search.evaluate((input, value) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
  await type('Marked')
  await expect(rows).toHaveCount(VIDEO_COUNT / 10)
  await expectValidPageRange(page)
  await type('')
  await expect(rows).not.toHaveCount(VIDEO_COUNT / 10)

  // A wider window shortens every row, including released shells.
  await jumpToEnd(page)
  await setWindowSize(app, page, { width: 1800, height: 1000 })
  await page.setViewportSize({ width: Math.round(1800 * uiScale / 100), height: Math.round(1000 * uiScale / 100) })
  await expectValidPageRange(page)

  // Removing videos from the end shortens the list below the current offset.
  await jumpToEnd(page)
  await page.evaluate(() => {
    const removed = window.$store.getters.getPlaylist('windowing').videos.slice(20)
    return window.$store.dispatch('removeVideos', {
      _id: 'windowing',
      playlistItemIds: removed.map(video => video.playlistItemId),
      videoIds: removed.map(video => video.videoId),
    })
  })
  await expect(rows).toHaveCount(20)
  await expectValidPageRange(page)
})

test('keeps only rows near the viewport mounted in long playlists', { tag: '@performance' }, async ({ page }) => {
  await openPlaylist(page)
  await scrollToEnd(page)
  const mountedRows = rowsOf(page).filter({ has: page.locator('.ft-list-video') })
  await expect.poll(() => mountedRows.count()).toBeLessThan(VIDEO_COUNT / 2)
})
