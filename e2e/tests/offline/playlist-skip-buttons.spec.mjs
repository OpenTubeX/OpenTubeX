import { goTo, test, expect } from '../../helpers/app.mjs'
import { activeTab, playWhenLoaded, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const VIDEO_TITLES = ['Skip test video one', 'Skip test video two', 'Skip test video three']
const SHORT_PLAYLIST_ID = 'e2eshortplaylist'
const SHORT_PLAYLIST_NAME = 'Short autoplay playlist'

function playlistVideo(title, index, isShort = false) {
  return {
    videoId: `skipvideo${index}`,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    lengthSeconds: 120,
    published: Date.now() - 86_400_000,
    timeAdded: Date.now() + index,
    playlistItemId: `e2e-skip-item-${index}`,
    type: 'video',
    isShort
  }
}

const seed = {
  settings: {
    // Keep the seeded order, the default sorts the newest addition to the top
    userPlaylistSortOrder: 'custom',
    useCustomShortsPlayer: true,
    loopShorts: true,
    autoplayPlaylists: true,
    videoPlaybackEngine: 'built-in',
    ytDlpPlaybackEngineDefaultMigration: true
  },
  playlists: [{
    _id: 'e2eskipplaylist',
    playlistName: 'Skip button playlist',
    protected: false,
    description: 'Playlist for the player skip buttons',
    videos: VIDEO_TITLES.map((title, index) => playlistVideo(title, index)),
    createdAt: Date.now() - 86_400_000,
    lastUpdatedAt: Date.now()
  }, {
    _id: SHORT_PLAYLIST_ID,
    playlistName: SHORT_PLAYLIST_NAME,
    protected: false,
    description: 'Playlist with a Short followed by a normal video',
    videos: VIDEO_TITLES.slice(0, 2).map((title, index) => playlistVideo(
      title,
      index,
      index === 0
    )),
    createdAt: Date.now() - 86_400_000,
    lastUpdatedAt: Date.now()
  }, {
    _id: 'e2esingleplaylist',
    playlistName: 'Single video playlist',
    protected: false,
    description: 'Playlist with one video',
    videos: [playlistVideo(VIDEO_TITLES[2], 2)],
    createdAt: Date.now() - 86_400_000,
    lastUpdatedAt: Date.now()
  }],
  history: ['Queued video', 'Standalone video'].map((title, index) => ({
    _id: `queuevideo${index}`,
    videoId: `queuevideo${index}`,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: '',
    viewCount: 100,
    lengthSeconds: 60,
    watchProgress: 0,
    isWatched: false,
    timeWatched: Date.now() - index,
    isLive: false,
    type: 'video'
  }))
}

test.use({ seed })

/**
 * The videos themselves cannot be loaded offline, but the playlist is local, so the
 * watch view still decides which skip buttons the player is allowed to show.
 * With `withNextVideo`, also reads the playlist video that skipping forward plays.
 */
function readSkipAvailability(page, withNextVideo = false) {
  return page.evaluate((withNextVideo) => {
    const app = document.querySelector('#app')?.__vue_app__

    const findWatchView = (vnode) => {
      if (vnode?.component?.type?.name === 'Watch') {
        return vnode.component.proxy
      }
      if (vnode?.component?.subTree) {
        const match = findWatchView(vnode.component.subTree)
        if (match) return match
      }
      if (Array.isArray(vnode?.children)) {
        for (const child of vnode.children) {
          const match = findWatchView(child)
          if (match) return match
        }
      }
      return null
    }

    const watchView = findWatchView(app?._container?._vnode)
    if (!watchView) {
      throw new Error('Unable to access the watch view')
    }

    return {
      canPlayNext: watchView.canSkipToNextVideo,
      canPlayPrevious: watchView.canSkipToPreviousVideo,
      ...(withNextVideo && { nextVideoId: watchView.$refs.watchVideoPlaylist?.nextVideo?.videoId })
    }
  }, withNextVideo)
}

test('only offers skipping to playlist videos that exist', async ({ page, attachScreenshot }) => {
  await page.route(/^https?:\/\//, (route) => route.fulfill({ status: 404, body: '' }))

  await goTo(page, 'userplaylists')
  await page.getByText('Skip button playlist').click()
  await expect(page).toHaveURL(/#\/playlist\/e2eskipplaylist/)

  await page.getByText(VIDEO_TITLES[0]).first().click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo0\?.*playlistId=e2eskipplaylist/)

  const playlistItems = page.locator('.watchVideoPlaylist .playlistItem')
  await expect(playlistItems).toHaveCount(VIDEO_TITLES.length)

  // First video: nothing before it
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: false
  })
  await attachScreenshot('first playlist video')

  // Loop wraps the playlist around in both directions
  const loopButton = page.locator('.watchVideoPlaylist.resizablePlaylist').getByRole('button', { name: 'Loop Playlist' })
  await loopButton.click()
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: true
  })
  await loopButton.click()

  // Last video: nothing after it
  await playlistItems.last().getByText(VIDEO_TITLES[2]).click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo2\?.*playlistId=e2eskipplaylist/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: false,
    canPlayPrevious: true
  })

  // Middle video: both directions available
  await playlistItems.nth(1).getByText(VIDEO_TITLES[1]).click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo1\?.*playlistId=e2eskipplaylist/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: true
  })
})

test('does not highlight another video after removing the playing one', async ({ page, attachScreenshot }) => {
  await page.route(/^https?:\/\//, (route) => route.fulfill({ status: 404, body: '' }))
  await goTo(page, 'userplaylists')
  await page.getByText('Skip button playlist').click()
  await page.getByText(VIDEO_TITLES[1]).first().click()
  await expect(page).toHaveURL(/#\/watch\/skipvideo1\?.*playlistId=e2eskipplaylist/)

  const playlistItems = page.locator('.watchVideoPlaylist.resizablePlaylist .playlistItem')
  const playingRow = playlistItems.filter({ has: page.getByText(VIDEO_TITLES[1], { exact: true }) })
  await expect(playingRow.locator('.videoIndexIcon')).toBeVisible()

  await playingRow.hover()
  await playingRow.getByTitle('Remove from Playlist').click()
  await expect(playlistItems).toHaveCount(VIDEO_TITLES.length - 1)
  await expect(playlistItems.locator('.videoIndexIcon')).toHaveCount(0)
  // Skipping still continues from where the removed video was.
  await expect.poll(() => readSkipAvailability(page, true)).toEqual({
    canPlayNext: true,
    canPlayPrevious: true,
    nextVideoId: 'skipvideo2'
  })
  await attachScreenshot('queue after removing the playing video')
})

test('continues a playlist after a Short ends', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  await goTo(page, 'userplaylists')
  await page.getByText(SHORT_PLAYLIST_NAME).click()
  await page.getByText(VIDEO_TITLES[0]).first().click()
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/skipvideo0\\?.*playlistId=${SHORT_PLAYLIST_ID}`))

  const video = await waitForPlayback(page)
  await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toHaveClass(/shortsPlayer/)
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: false
  })
  expect(await video.evaluate(element => element.loop)).toBe(false)

  await video.evaluate(element => {
    element.currentTime = Math.max(0, element.duration - 0.25)
  })

  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/skipvideo1\\?.*playlistId=${SHORT_PLAYLIST_ID}`))
  await waitForPlayback(page)
})

test('offers skipping to a queued video without a playlist', async ({ page }) => {
  await page.route(/^https?:\/\//, (route) => route.fulfill({ status: 404, body: '' }))

  await goTo(page, 'history')

  const queuedVideo = page.locator('.ft-list-video').filter({ hasText: 'Queued video' })
  await queuedVideo.hover()
  await queuedVideo.locator('.title').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to Queue' }).click()

  await page.locator('a.title').filter({ hasText: /Standalone video/ }).click()
  await expect(page).toHaveURL(/#\/watch\/queuevideo1/)
  await expect(page.locator('.watchQueue')).toBeVisible()

  // The queue supplies a next video, nothing supplies a previous one
  await expect.poll(() => readSkipAvailability(page)).toEqual({
    canPlayNext: true,
    canPlayPrevious: false
  })
})

// Manually selected videos stay paused, but the playlist still continues on its own
for (const { name, defaultInterval } of [
  { name: 'when the countdown ends', defaultInterval: 1 },
  { name: 'from Play Now', defaultInterval: 60 }
]) {
  test.describe(`with Start Videos Automatically turned off, ${name}`, () => {
    test.use({ seed: { ...seed, settings: { ...seed.settings, autoplayVideos: false, defaultInterval } } })

    test('starts the next playlist video', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)

      await goTo(page, 'userplaylists')
      await page.getByText('Skip button playlist').click()
      await page.getByText(VIDEO_TITLES[0]).first().click()
      await expect(page).toHaveURL(/#\/watch\/skipvideo0\?/)

      const video = page.locator(`${activeTab} video`)
      // The video waits for a cold watch page load, so allow as long as waitForPlayback does.
      await expect
        .poll(() => video.evaluate(element => element.readyState).catch(() => 0), { timeout: 60_000 })
        .toBeGreaterThanOrEqual(1)
      expect(await video.evaluate(element => element.paused), 'a manually selected video must not start').toBe(true)

      await playWhenLoaded(video)
      await waitForPlayback(page)
      await video.evaluate(element => {
        element.currentTime = Math.max(0, element.duration - 0.25)
      })

      if (defaultInterval > 1) {
        await page.locator('.autoplayCountdownOverlay').getByRole('button', { name: 'Play Now' }).click()
      }
      await expect(page).toHaveURL(/#\/watch\/skipvideo1\?/)
      await waitForPlayback(page)
    })
  })
}

test.describe('with a looping single-video playlist', () => {
  test.use({ seed: { ...seed, settings: { ...seed.settings, autoplayVideos: false, defaultInterval: 1 } } })

  test('replays the video when the countdown ends', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    await goTo(page, 'userplaylists')
    await page.getByText('Single video playlist').click()
    await page.getByText(VIDEO_TITLES[2]).first().click()
    await expect(page).toHaveURL(/#\/watch\/skipvideo2\?/)
    await page.locator(`${activeTab} .watchVideoPlaylist`).getByRole('button', { name: 'Loop Playlist' }).click()

    const video = page.locator(`${activeTab} video`)
    // The video waits for a cold watch page load, so allow as long as waitForPlayback does.
    await expect
      .poll(() => video.evaluate(element => element.readyState).catch(() => 0), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(1)
    await playWhenLoaded(video)
    await waitForPlayback(page)

    // The first loop drops extra query parameters from the opened route, later loops keep the same route
    for (let loop = 0; loop < 2; loop++) {
      await video.evaluate(element => {
        element.currentTime = Math.max(0, element.duration - 0.25)
      })
      await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
      await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime < element.duration / 2)).toBe(true)
    }
    await expect(page).toHaveURL(/#\/watch\/skipvideo2\?/)
  })
})
