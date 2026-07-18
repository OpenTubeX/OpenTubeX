import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'
import { activeTab, waitForPlaybackOrSkip } from '../../helpers/player.mjs'

const VIDEO_ONE = 'https://www.youtube.com/watch?v=jNQXAC9IVRw' // Me at the zoo
const VIDEO_TWO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' // Big Buck Bunny

async function openVideoInActiveTab(page, url) {
  await page.locator(sel.searchInput).fill(url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\//)
  await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible({ timeout: 30_000 })
  return waitForPlaybackOrSkip(test, page)
}

// Regression: quick playback speed state leaked between tabs (021b06197)
test('playback speed is isolated per tab', async ({ page, innertube }) => {
  test.skip(!innertube.playback, 'needs real media streams')
  test.slow()

  await openVideoInActiveTab(page, VIDEO_ONE)

  await page.locator(sel.newTabButton).click()
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  const secondVideo = await openVideoInActiveTab(page, VIDEO_TWO)

  // Speed up the second tab's player only.
  await page.locator('body').press('p')
  await expect.poll(async () => await secondVideo.evaluate((el) => el.playbackRate)).toBeGreaterThan(1)

  // The first tab's player must still play at normal speed.
  await page.locator(sel.tabs).first().click()
  const firstVideo = page.locator(`${activeTab} video`)
  await expect(firstVideo).toBeVisible()
  expect(await firstVideo.evaluate((el) => el.playbackRate)).toBe(1)
})
