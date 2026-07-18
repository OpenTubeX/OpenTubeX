import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'
import { waitForPlaybackOrSkip } from '../../helpers/player.mjs'

// "Me at the zoo" - the oldest video on YouTube, short and stable.
const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

async function openVideo(page) {
  await page.locator(sel.searchInput).fill(VIDEO_URL)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  await expect(page.locator('.videoTitle')).toContainText('Me at the zoo', { timeout: 30_000 })
}

test.describe('watch page', () => {
  test('shows video metadata', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)
    await expect(page.getByText('jawed').first()).toBeVisible()
  })

  test('playback starts', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)
    await expect
      .poll(async () => await video.evaluate((el) => el.currentTime), { timeout: 30_000 })
      .toBeGreaterThan(1)
  })

  // Regression: playback speed controls stopped working (1c958d468)
  test('keyboard shortcuts change the playback rate', async ({ page, innertube }) => {
    test.skip(!innertube.playback, 'needs real media streams')
    await openVideo(page)

    const video = await waitForPlaybackOrSkip(test, page)

    await page.locator('body').press('p')
    await expect.poll(async () => await video.evaluate((el) => el.playbackRate)).toBeGreaterThan(1)
    const raisedRate = await video.evaluate((el) => el.playbackRate)

    await page.locator('body').press('o')
    await expect.poll(async () => await video.evaluate((el) => el.playbackRate)).toBeLessThan(raisedRate)
  })

  test('comments load on request', async ({ page, innertube }) => {
    test.skip(innertube.replay, 'watch page hydration needs the real API')
    await openVideo(page)

    const loadComments = page.locator('.getCommentsTitle')
    await loadComments.scrollIntoViewIfNeeded()
    await loadComments.click()

    await expect(page.locator('.commentsTitle')).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('.comment').count()).toBeGreaterThan(0)
  })
})
