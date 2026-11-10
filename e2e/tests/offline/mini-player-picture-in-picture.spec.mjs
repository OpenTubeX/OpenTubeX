import path from 'node:path'

import { test, expect, goTo, repoRoot } from '../../helpers/app.mjs'

const mediaPath = path.join(repoRoot, 'e2e/fixtures/media/demo.webm')
const playlistVideo = (videoId, title, index) => ({
  videoId,
  title,
  author: 'Test Channel',
  authorId: 'UC0000000000000000000000',
  lengthSeconds: 60,
  timeAdded: 1700000000000 - index,
  playlistItemId: `item-${index}`,
  type: 'video',
})
const download = (id, videoId, title) => ({
  id,
  videoId,
  title,
  status: 'completed',
  mode: 'video',
  destination: mediaPath,
  destinations: [mediaPath],
  files: [{ videoId, path: mediaPath, extension: 'webm' }],
})

test.use({
  seed: {
    settings: {
      landingPage: 'history',
      enableDownloads: true,
      keepPlayingOnNavigation: true,
      defaultInterval: 0,
      autoPictureInPictureTriggers: ['tab', 'minimize', 'blur'],
    },
    playlists: [{
      _id: 'downloaded-playlist',
      playlistName: 'Downloaded playlist',
      protected: false,
      description: '',
      videos: [playlistVideo('offline0001', 'Playlist video one', 0), playlistVideo('offline0002', 'Playlist video two', 1)],
    }],
    downloads: [download(1, 'offline0001', 'Playlist video one'), download(2, 'offline0002', 'Playlist video two')],
  },
})

/**
 * Emits the native window focus events. The renderer reads `document.hasFocus()`
 * as well, which the test cannot control otherwise.
 */
async function setFocused(app, page, focused) {
  await page.evaluate((value) => {
    window.__e2eFocused = value
    document.hasFocus = () => window.__e2eFocused
  }, focused)
  await app.electronApp.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].emit(value ? 'focus' : 'blur')
  }, focused)
}

function pictureInPictureActive(page) {
  return page.evaluate(() => document.pictureInPictureElement !== null)
}

async function openPlaylistVideo(app, page) {
  await page.context().route(/^https?:/, route => route.abort('internetdisconnected'))
  await setFocused(app, page, true)
  await goTo(page, 'userplaylists')
  await page.getByText('Downloaded playlist').click()
  await page.locator('.ft-list-video').filter({ hasText: 'Playlist video one' }).locator('.thumbnailLink').click()
  const player = page.locator('.ftVideoPlayer')
  const video = player.locator('video')
  await expect(video).toHaveAttribute('src', /^downloadmedia:\/\/file\/1\/offline0001/)
  await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)
  return { player, video }
}

test('returns from Picture-in-Picture to the mini player', async ({ app, page }) => {
  const { player, video } = await openPlaylistVideo(app, page)
  await page.getByRole('link', { name: 'Go to History', exact: true }).click()
  await expect(player).toHaveClass(/scrollMiniPlayer/)

  await setFocused(app, page, false)
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)
  await setFocused(app, page, true)
  await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await expect(player).toBeVisible()
  await expect.poll(() => video.evaluate(element => !element.paused)).toBe(true)
})

test('returns from Picture-in-Picture to the next playlist video', async ({ app, page }) => {
  const { player, video } = await openPlaylistVideo(app, page)
  await setFocused(app, page, false)
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)
  await video.evaluate(element => { element.currentTime = element.duration - 0.2 })
  await expect(video).toHaveAttribute('src', /^downloadmedia:\/\/file\/2\/offline0002/)
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  await setFocused(app, page, true)
  await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  await expect(page).toHaveURL(/#\/watch\/offline0002\?/)
  await expect(player).not.toHaveClass(/scrollMiniPlayer/)
  await expect(player).toBeVisible()
})
