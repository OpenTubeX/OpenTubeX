import { expect } from '@playwright/test'

export const activeTab = '.tabContent[aria-hidden="false"]'

/**
 * Finds the mounted Watch component. Pass this function directly to
 * `page.evaluateHandle()` so the returned Vue component remains in the page.
 */
export function findWatchComponent() {
  const app = document.querySelector('#app')?.__vue_app__
  const find = (vnode) => {
    if (vnode?.component?.refs?.player) return vnode.component
    if (vnode?.component?.subTree) {
      const match = find(vnode.component.subTree)
      if (match) return match
    }
    if (Array.isArray(vnode?.children)) {
      for (const child of vnode.children) {
        const match = find(child)
        if (match) return match
      }
    }
    return null
  }

  return find(app?._container?._vnode)
}

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
