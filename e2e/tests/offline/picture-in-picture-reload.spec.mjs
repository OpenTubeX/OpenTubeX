import { test, expect, setPlayerFullscreen } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, reloadWatchView, watchViewHandle } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      autoPictureInPictureTriggers: ['minimize'],
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

async function setFocused(app, page, focused) {
  await page.evaluate((value) => {
    window.__e2eFocused = value
    document.hasFocus = () => window.__e2eFocused
  }, focused)
  await app.electronApp.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].emit(value ? 'focus' : 'blur')
  }, focused)
}

async function setMinimized(app, minimized) {
  await app.electronApp.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].emit(value ? 'minimize' : 'restore')
  }, minimized)
}

function pictureInPictureActive(page) {
  return page.evaluate(() => document.pictureInPictureElement !== null)
}

async function makeDetachedPictureInPictureExitHang(page) {
  await page.evaluate(() => {
    const nativeExitPictureInPicture = document.exitPictureInPicture.bind(document)
    document.exitPictureInPicture = () => {
      if (document.pictureInPictureElement?.isConnected === false) {
        return new Promise(resolve => { window.__resolveStalePipExit = resolve })
      }
      return nativeExitPictureInPicture()
    }
  })
}

async function createDetachedPictureInPictureOwner(video) {
  await video.evaluate(async element => {
    const owner = document.createElement('div')
    owner.className = 'ftVideoPlayer'
    owner.dataset.tabId = element.closest('.ftVideoPlayer').dataset.tabId
    const orphan = document.createElement('video')
    orphan.muted = true
    orphan.src = element.currentSrc
    owner.append(orphan)
    document.body.append(owner)
    await orphan.play()
    await orphan.requestPictureInPicture()
    owner.remove()
  })
}

test('restores automatic Picture-in-Picture across a video reload', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setFocused(app, page, true)
  await openMockedVideo(page)

  await setMinimized(app, true)
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  const watchView = await watchViewHandle(page)
  await reloadWatchView(watchView)
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  await setMinimized(app, false)
  await expect.poll(() => pictureInPictureActive(page)).toBe(false)
})

test('clears a detached PiP owner when mounting a replacement player', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setFocused(app, page, true)
  const video = await openMockedVideo(page)

  await makeDetachedPictureInPictureExitHang(page)
  await createDetachedPictureInPictureOwner(video)
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement?.isConnected)).toBe(false)

  const watchView = await watchViewHandle(page)
  await reloadWatchView(watchView)
  await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  await setPlayerFullscreen(page, true)
  await setPlayerFullscreen(page, false)
})

test('restores user-opened Picture-in-Picture across a video reload', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setFocused(app, page, true)
  const video = await openMockedVideo(page)

  await makeDetachedPictureInPictureExitHang(page)
  await video.evaluate(element => element.requestPictureInPicture())
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  const watchView = await watchViewHandle(page)
  await reloadWatchView(watchView)
  const replacementVideo = await waitForPlayback(page)
  await expect.poll(() => replacementVideo.evaluate(
    element => document.pictureInPictureElement === element
  )).toBe(true)

  await setMinimized(app, false)
  // Restoring must not exit Picture-in-Picture; give a stale exit time to land.
  await page.waitForTimeout(1000)
  expect(await pictureInPictureActive(page)).toBe(true)
})

test('does not transfer Picture-in-Picture from another tab during reload', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setFocused(app, page, true)
  const firstVideo = await openMockedVideo(page)
  const firstTabId = await page.locator(activeTab).getAttribute('data-tab-id')

  await firstVideo.evaluate(element => element.requestPictureInPicture())
  await expect.poll(() => firstVideo.evaluate(
    element => document.pictureInPictureElement === element
  )).toBe(true)

  await page.keyboard.press('Control+t')
  await openMockedVideo(page)
  const secondTabId = await page.locator(activeTab).getAttribute('data-tab-id')

  const watchView = await watchViewHandle(page, secondTabId)
  await reloadWatchView(watchView)
  await waitForPlayback(page)

  const originalVideo = page.locator(`.tabContent[data-tab-id="${firstTabId}"] video`)
  expect(await originalVideo.evaluate(
    element => document.pictureInPictureElement === element
  )).toBe(true)
})

test.describe('after default Picture-in-Picture startup', () => {
  test.use({
    seed: {
      settings: {
        autoPictureInPictureTriggers: ['minimize'],
        defaultViewingMode: 'pip',
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true
      }
    }
  })

  test('recovers a detached owner after the startup request settles', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setFocused(app, page, true)
    const video = await openMockedVideo(page)
    await expect.poll(() => video.evaluate(
      element => document.pictureInPictureElement === element
    )).toBe(true)

    await makeDetachedPictureInPictureExitHang(page)
    await page.evaluate(() => document.exitPictureInPicture())
    await createDetachedPictureInPictureOwner(video)
    await expect.poll(() => page.evaluate(
      () => document.pictureInPictureElement?.isConnected
    )).toBe(false)

    await setFocused(app, page, false)
    await expect.poll(() => pictureInPictureActive(page)).toBe(false)
    await setPlayerFullscreen(page, true)
    await setPlayerFullscreen(page, false)
  })
})

// The native poster attribute stays removed during playback because Chromium
// can stretch it across the compositor surface when entering PiP (#362). The
// inline player shows the DOM poster overlay instead while PiP is active.
test('shows the poster overlay inline while in Picture-in-Picture', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setFocused(app, page, true)
  const video = await openMockedVideo(page)
  const poster = page.locator(`${activeTab} .ftVideoPlayer .countdownPoster`)
  const message = poster.locator('.pictureInPictureMessage')

  await expect(poster).toBeAttached()
  await expect(poster).toBeHidden()

  await video.evaluate(element => element.requestPictureInPicture())
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)
  await expect(poster).toBeVisible()
  // The overlay covers Chromium's own PiP message, so it shows a replacement.
  await expect(message).toHaveText('Playing in Picture-in-Picture')
  await expect(video).not.toHaveAttribute('poster')

  await page.evaluate(() => document.exitPictureInPicture())
  await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  await expect(poster).toBeHidden()
  await expect(message).toHaveCount(0)
})
