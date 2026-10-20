import { test, expect, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test('cold player script extraction runs outside the renderer thread', { tag: '@performance' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => {
    window.__playerExtractionJobs = 0
    const postMessage = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.operation === 'extractPlayer') window.__playerExtractionJobs++
      return postMessage.call(this, message, ...args)
    }
  })
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect.poll(() => page.locator('video').evaluateAll(videos => videos.some(video => !video.paused && video.currentTime > 0))).toBe(true)
  expect(await page.evaluate(() => window.__playerExtractionJobs)).toBe(1)
})
