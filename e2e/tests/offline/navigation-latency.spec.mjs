import { test, expect, goTo } from '../../helpers/app.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'

test('opens phone settings without repeated scrollbar remeasurement before painting', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await goTo(page, 'settings')
  const reads = await page.evaluate(() => new Promise(resolve => {
    const originalStyle = window.getComputedStyle
    let reads = 0
    window.getComputedStyle = (...args) => {
      if (args[0].matches('.settingsContent')) reads++
      return originalStyle(...args)
    }
    document.querySelector('.settingsMenu [data-section="playback"]').click()
    requestAnimationFrame(() => {
      window.getComputedStyle = originalStyle
      resolve(reads)
    })
  }))
  await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
  // Bound layout work instead of asserting machine-dependent milliseconds.
  expect(reads).toBeLessThanOrEqual(20)
})

test.describe('Home subscription processing', () => {
  test.use({
    seed: {
      ...largeSubscriptionsSeed,
      profiles: largeSubscriptionsSeed.profiles.map(profile => ({
        ...profile,
        subscriptions: profile.subscriptions.slice(0, 300)
      })),
      subscriptionCache: largeSubscriptionsSeed.subscriptionCache.slice(0, 300)
    }
  })

  test('opens Home without copying the cache or repeatedly reading reactive sort keys', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await goTo(page, 'userplaylists')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.navigationCopies = 0
      window.navigationTimestampReads = 0
      for (const channel of Object.values(store.getters.getVideoCache)) {
        for (const video of channel.videos) {
          Object.defineProperty(video, 'navigationCopyProbe', {
            configurable: true,
            enumerable: true,
            get() { window.navigationCopies++; return true }
          })
          const published = video.published
          Object.defineProperty(video, 'published', {
            configurable: true,
            enumerable: true,
            get() { window.navigationTimestampReads++; return published }
          })
        }
      }
    })
    await goTo(page, 'home')
    await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.navigationCopies)).toBe(0)
    expect(await page.evaluate(() => window.navigationTimestampReads)).toBeLessThanOrEqual(3 * 300 * 36)

    // The shelf keeps the source entries reactive after skipping decoration.
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channel = store.getters.getActiveProfile.subscriptions[0].id
      store.getters.getVideoCache[channel].videos[0].title = 'Updated Home video'
    })
    await expect(page.getByText('Updated Home video', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channel = store.getters.getActiveProfile.subscriptions[0].id
      store.getters.getVideoCache[channel].videos[0].isNewInSubscriptionFeed = false
    })
    await expect(page.getByText('Updated Home video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Video 1-0', { exact: true })).toBeVisible()
  })
})
