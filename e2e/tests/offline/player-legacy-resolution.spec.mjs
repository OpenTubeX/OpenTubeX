import { sel, test, expect } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { DEMO_MEDIA_URL, demoPlayerResponse } from '../../helpers/media.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

/**
 * Serves the demo video as a second progressive format, so the player offers a legacy resolution choice.
 * @param {import('@playwright/test').Page} page
 */
function routeTwoLegacyFormats(page) {
  return page.route('**/youtubei/v1/player**', route => {
    const response = demoPlayerResponse(JSON.parse(route.request().postData()).videoId)
    const [format] = response.streamingData.formats
    response.streamingData.formats.push({
      ...format,
      itag: 5,
      url: `${DEMO_MEDIA_URL}&res=240`,
      width: 426,
      height: 240,
      quality: 'small',
      qualityLabel: '240p'
    })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
  })
}

/**
 * Selects 240p and waits until the new source could have started through the autoplay attribute.
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<void>} [duringLoad] runs after the selection, before waiting for the new source
 */
async function selectLowerResolution(page, duringLoad) {
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  const video = player.locator('video')
  await player.evaluate(element => {
    window.resolutionLoaded = false
    element.ui.getControls().getPlayer().addEventListener('loaded', () => {
      window.resolutionLoaded = true
    }, { once: true })
  })

  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('shown', 'true'))
  await player.getByRole('button', { name: 'More settings', exact: true }).click()
  await player.locator('.legacy-quality-button').click()
  await player.locator('.legacy-qualities').getByRole('button', { name: '240p', exact: true }).click()
  await duringLoad?.()
  await expect.poll(() => page.evaluate(() => window.resolutionLoaded)).toBe(true)
  await expect.poll(() => video.evaluate(element => element.readyState)).toBe(4)
  await video.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test.describe('legacy resolution changes', () => {
  test.use({ seed: { settings: { ...WATCH_PAGE_SEED, autoplayVideos: true } } })

  test('keep a paused video paused', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routeTwoLegacyFormats(page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => {
      element.pause()
      element.playEvents = 0
      element.addEventListener('play', () => { element.playEvents++ })
    })

    await selectLowerResolution(page)

    expect(await video.evaluate(element => ({ paused: element.paused, playEvents: element.playEvents })))
      .toEqual({ paused: true, playEvents: 0 })
    expect(await video.evaluate(element => element.autoplay)).toBe(true)
  })

  test('play a paused video that is played while the new resolution loads', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routeTwoLegacyFormats(page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    let releaseMedia
    const mediaReady = new Promise(resolve => { releaseMedia = resolve })
    let mediaRequested
    const requested = new Promise(resolve => { mediaRequested = resolve })
    await page.route(/googlevideo\.com\/videoplayback.*res=240/, async route => {
      mediaRequested()
      await mediaReady
      await route.fallback()
    })

    await selectLowerResolution(page, async () => {
      await requested
      await video.evaluate(element => { element.play().catch(() => {}) })
      releaseMedia()
    })

    await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)
  })
})

test.describe('legacy resolution changes without autoplay', () => {
  test.use({ seed: { settings: { ...WATCH_PAGE_SEED, autoplayVideos: false } } })

  test('keep a playing video playing', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routeTwoLegacyFormats(page)
    await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    await page.locator(sel.searchInput).press('Enter')
    const video = page.locator(`${activeTab} video`)
    await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 30_000 }).toBe(4)
    await video.evaluate(element => element.play())
    await waitForPlayback(page)

    await selectLowerResolution(page)

    await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)
  })
})
