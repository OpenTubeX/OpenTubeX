import { expect } from '@playwright/test'
import { findWatchComponent } from '../../e2e/helpers/player.mjs'

/**
 * Waits for the Watch page to finish its own load, then replaces its video
 * with a local fixture until the fixture is ready. The tests block the page's
 * requests, and on a busy device the page can report that failure after the
 * fixture replaced its video, which removes the player.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, unknown>} fields Watch page data for the fixture,
 *   such as `legacyFormats` or `manifestSrc`
 * @returns {Promise<import('@playwright/test').JSHandle>} the Watch component
 */
export async function replaceWatchVideo(page, fields) {
  await expect.poll(async () => {
    const handle = await page.evaluateHandle(findWatchComponent)
    try {
      return await handle.evaluate(component => !!component && component.proxy.onMountedRun && !component.proxy.isLoading &&
        component.proxy.preparingVideoLoadGeneration === null && component.proxy.isCurrentlyPresented())
    } finally { await handle.dispose() }
  }, { timeout: 60_000 }).toBe(true)
  const watch = await page.evaluateHandle(findWatchComponent)
  const video = page.locator('.ftVideoPlayer video')
  await expect(async () => {
    await watch.evaluate((component, fields) => {
      const watch = component.proxy
      watch.videoLoadGeneration++
      Object.assign(watch, {
        isLoading: false,
        ytDlpStreamsPending: false,
        errorMessage: null,
        isUpcoming: false,
        isLive: false,
        localFilePlayback: true,
        ...fields,
      })
    }, fields)
    await expect.poll(() => video.evaluate(element => element.readyState), { timeout: 20_000 }).toBe(4)
  }).toPass({ timeout: 120_000 })
  return watch
}
