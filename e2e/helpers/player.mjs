import { expect } from '@playwright/test'

import { sel } from './app.mjs'

export const activeTab = '.tabContent[aria-hidden="false"]'

/**
 * Opens a watch page and waits for its player, or skips when the live API
 * refuses to serve it (bot checks and IP blocks on CI runners and VPNs),
 * which leaves the page shell without any video data or replaces the player
 * with an error message.
 *
 * The metadata hydrates before the streams do, so the error has to win over a
 * loaded title: an IP block still renders the title, description and
 * recommendations, only the player is missing.
 */
export async function openVideoOrSkip(test, page, video) {
  await page.locator(sel.searchInput).fill(video.url)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${video.id}`))

  const title = page.locator(`${activeTab} .videoTitle`)
  const errorMessage = page.locator(`${activeTab} .errorMessage`)
  const player = page.locator(`${activeTab} .ftVideoPlayer`)
  let state = 'waiting'
  const settled = await expect
    .poll(async () => {
      if (await errorMessage.isVisible().catch(() => false)) {
        state = (await errorMessage.textContent())?.trim() ?? 'unavailable'
      } else if (await player.isVisible().catch(() => false)) {
        const titleText = await title.textContent().catch(() => '') ?? ''
        if (titleText.includes(video.title)) {
          state = 'loaded'
        }
      }
      return state === 'waiting' ? 'waiting' : 'done'
    }, { timeout: 60_000, message: 'waiting for the watch page to load' })
    .toBe('done')
    .then(() => true, () => false)

  test.skip(!settled || state !== 'loaded', `watch page unavailable from the live API: ${state}`)
}

/**
 * Asserts that the scroll mini player sits in the bottom right corner.
 *
 * @param {import('@playwright/test').Locator} player
 * @param {{ width: number, height: number }} viewport
 */
export async function expectDockedToBottomRight(player, viewport, margin = 16) {
  // Polled because the layout animation skews the box for its first 300ms.
  await expect.poll(async () => {
    const box = await player.boundingBox()
    if (!box) return null

    return {
      right: Math.round(viewport.width - (box.x + box.width)),
      bottom: Math.round(viewport.height - (box.y + box.height))
    }
  }).toEqual({ right: margin, bottom: margin })
}

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
 * Opens a video that is served entirely from local mocks (see
 * `mockPlayableWatchPage` in watch.mjs), so nothing has to be skipped.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [videoId]
 */
export async function openMockedVideo(page, videoId = 'jNQXAC9IVRw') {
  await page.locator(sel.searchInput).fill(`https://www.youtube.com/watch?v=${videoId}`)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/${videoId}`))
  await expect(page.locator(`${activeTab} .ftVideoPlayer`)).toBeVisible({ timeout: 30_000 })

  return waitForPlayback(page)
}

/**
 * Waits until the video in the active tab plays and returns its locator.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function waitForPlayback(page) {
  const video = page.locator(`${activeTab} video`)

  await expect
    .poll(
      () => video.evaluate((element) => element.currentTime).catch(() => 0),
      { timeout: 60_000, message: 'waiting for playback to start' }
    )
    .toBeGreaterThan(0)

  return video
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
