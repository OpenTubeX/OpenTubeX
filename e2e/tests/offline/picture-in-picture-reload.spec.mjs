import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

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

test('restores automatic Picture-in-Picture across a video reload', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setFocused(app, page, true)
  await openMockedVideo(page)

  await setMinimized(app, true)
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(view => view.reloadView())
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  await setMinimized(app, false)
  await expect.poll(() => pictureInPictureActive(page)).toBe(false)
})

test('restores user-opened Picture-in-Picture across a video reload', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await setFocused(app, page, true)
  const video = await openMockedVideo(page)

  await video.evaluate(element => element.requestPictureInPicture())
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  const watchView = await watchViewHandle(page)
  await watchView.evaluate(view => view.reloadView())
  await expect.poll(() => pictureInPictureActive(page)).toBe(true)

  await setMinimized(app, false)
  await page.waitForTimeout(1000)
  expect(await pictureInPictureActive(page)).toBe(true)
})
