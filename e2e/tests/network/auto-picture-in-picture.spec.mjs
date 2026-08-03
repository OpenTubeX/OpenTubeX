import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'
import { activeTab, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO = { id: 'jNQXAC9IVRw', title: 'Me at the zoo', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }

test.use({ seed: { settings: { autoPictureInPictureTriggers: ['tab', 'minimize', 'blur'] } } })

/**
 * The renderer derives the focus part of the auto PiP triggers from
 * `document.hasFocus()`, which is not controllable from the test (and is
 * unreliable without a window manager), so it is driven explicitly here.
 */
async function stubFocus(page) {
  await page.evaluate(() => {
    window.__e2eFocused = true
    document.hasFocus = () => window.__e2eFocused
  })
}

async function setFocused(page, focused) {
  await page.evaluate((value) => {
    window.__e2eFocused = value
    window.dispatchEvent(new Event(value ? 'focus' : 'blur'))
  }, focused)
}

/**
 * Emits the native window event on the real BrowserWindow, so the main
 * process forwards the minimized state the same way it does in production.
 * Xvfb has no window manager, so `minimize()` itself would never be honoured.
 */
async function setMinimized(app, minimized) {
  await app.electronApp.evaluate(({ BrowserWindow }, event) => {
    BrowserWindow.getAllWindows()[0].emit(event)
  }, minimized ? 'minimize' : 'restore')
}

function pictureInPictureActive(page) {
  return page.evaluate(() => document.pictureInPictureElement !== null)
}

async function openVideo(page) {
  await page.locator(sel.searchInput).fill(VIDEO.url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${VIDEO.id}`))
  await expect(page.locator('.videoTitle')).toContainText(VIDEO.title, { timeout: 30_000 })
  await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible({ timeout: 30_000 })
}

test.describe('automatic Picture-in-Picture', () => {
  test.beforeEach(async ({ page }) => {
    await stubFocus(page)
    await openVideo(page)
    await waitForPlaybackOrSkip(test, page)
    // The blur trigger would fire on its own if the harness window never
    // gained focus, so start from a known focused state.
    await setFocused(page, true)
    await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  })

  // Regression (#492, #265): with several triggers enabled, restoring the
  // window left the video stranded in the PiP window.
  test('restoring the window re-embeds the video', async ({ app, page }) => {
    await setMinimized(app, true)
    await expect.poll(() => pictureInPictureActive(page)).toBe(true)

    await setMinimized(app, false)
    await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  })

  // Regression (#492): the blur the window manager delivers while the closing
  // PiP window hands focus back reopened PiP right after the restore closed it.
  test('a stale blur after restoring does not reopen PiP', async ({ app, page }) => {
    await setMinimized(app, true)
    await expect.poll(() => pictureInPictureActive(page)).toBe(true)

    await setMinimized(app, false)
    await expect.poll(() => pictureInPictureActive(page)).toBe(false)

    await setFocused(page, false)
    // Longer than the delay after which the blur trigger is re-checked, so a
    // reopen would have happened by now.
    await page.waitForTimeout(2000)
    expect(await pictureInPictureActive(page)).toBe(false)
  })

  test('losing focus after a real focus still enters PiP', async ({ app, page }) => {
    await setMinimized(app, true)
    await expect.poll(() => pictureInPictureActive(page)).toBe(true)
    await setMinimized(app, false)
    await expect.poll(() => pictureInPictureActive(page)).toBe(false)

    await setFocused(page, true)
    await setFocused(page, false)
    await expect.poll(() => pictureInPictureActive(page)).toBe(true)

    await setFocused(page, true)
    await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  })

  // Regression (#492): blur and minimize fire within the same window
  // transition, and PiP toggling is asynchronous, so the second trigger used
  // to request a toggle that cancelled out the first one.
  test('blur and minimize together open PiP exactly once', async ({ app, page }) => {
    // Deliberately not awaiting the PiP state in between, so the second
    // trigger lands while the PiP request is still in flight.
    await setFocused(page, false)
    await setMinimized(app, true)

    await expect.poll(() => pictureInPictureActive(page)).toBe(true)
    await page.waitForTimeout(2000)
    expect(await pictureInPictureActive(page)).toBe(true)

    await setMinimized(app, false)
    await expect.poll(() => pictureInPictureActive(page)).toBe(false)
  })

  test('does not close a PiP window that the user opened', async ({ app, page }) => {
    await page.locator(`${activeTab} video`).evaluate(element => element.requestPictureInPicture())
    await expect.poll(() => pictureInPictureActive(page)).toBe(true)

    await setMinimized(app, true)
    await setMinimized(app, false)
    await page.waitForTimeout(2000)
    expect(await pictureInPictureActive(page)).toBe(true)
  })
})
