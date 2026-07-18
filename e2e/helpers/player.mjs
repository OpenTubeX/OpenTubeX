import { expect } from '@playwright/test'

export const activeTab = '.tabContent[aria-hidden="false"]'

/**
 * Waits for playback to start in the active tab and returns the video
 * locator. If YouTube blocks media streaming from this IP (common on CI
 * runners and VPNs), the test is skipped with a clear reason instead of
 * timing out - tests that don't depend on playback keep running.
 */
export async function waitForPlaybackOrSkip(test, page) {
  const video = page.locator(`${activeTab} video`)
  const blocked = page.locator(`${activeTab} .errorMessage`, { hasText: /blocked your IP address/i })

  let state = 'waiting'
  await expect
    .poll(async () => {
      if (await blocked.isVisible().catch(() => false)) {
        state = 'blocked'
        return 'done'
      }
      const currentTime = await video.evaluate((el) => el.currentTime).catch(() => 0)
      if (currentTime > 0) {
        state = 'playing'
        return 'done'
      }
      return 'waiting'
    }, { timeout: 60_000, message: 'waiting for playback to start or an IP-block error' })
    .toBe('done')

  test.skip(state === 'blocked', 'YouTube blocked media streaming from this IP')
  return video
}
