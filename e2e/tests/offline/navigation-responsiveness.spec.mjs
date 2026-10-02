import { test, expect, goTo } from '../../helpers/app.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'

test.describe('Videos feed navigation', () => {
  test.use({ seed: largeSubscriptionsSeed })

  test.beforeEach(async ({ page }) => {
    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(page.locator('#subscriptionsPanel .ft-list-video').first()).toBeVisible()
  })

  test('reuses the unchanged feed when returning from Playlists', async ({ page }) => {
    for (const viewport of [{ width: 375, height: 700 }, { width: 700, height: 375 }]) {
      await page.setViewportSize(viewport)
      await goTo(page, 'userplaylists')
      await page.evaluate(() => {
        window.navigationOriginalSort = Array.prototype.sort
        window.navigationFeedSorts = 0
        // Count expensive feed sorts without relying on machine-specific timing.
        // eslint-disable-next-line no-extend-native
        Array.prototype.sort = function (...args) {
          if (this.length >= 30_000) window.navigationFeedSorts++
          return window.navigationOriginalSort.apply(this, args)
        }
      })
      try {
        await goTo(page, 'subscriptions')
        await expect(page.locator('#subscriptionsPanel .ft-list-video').first()).toBeVisible()
        expect(await page.evaluate(() => window.navigationFeedSorts)).toBe(0)
      } finally {
        await page.evaluate(() => {
          // eslint-disable-next-line no-extend-native
          Array.prototype.sort = window.navigationOriginalSort
          delete window.navigationOriginalSort
          delete window.navigationFeedSorts
        })
      }
    }
  })

  test('uses cache updates and profile changes made while visiting Playlists', async ({ page }) => {
    await goTo(page, 'userplaylists')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channelId = store.getters.getActiveProfile.subscriptions[0].id
      store.commit('updateVideoCacheByChannel', {
        channelId,
        entries: [{
          ...store.getters.getVideoCache[channelId].videos[0],
          videoId: 'newly-cached',
          title: 'Newly cached video',
          published: Date.now()
        }]
      })
    })
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Newly cached video', { exact: true })).toBeVisible()

    await goTo(page, 'userplaylists')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertProfileToList', { ...store.getters.getActiveProfile, subscriptions: [] })
    })
    await goTo(page, 'subscriptions')
    await expect(page.locator('#subscriptionsPanel .ft-list-video')).toHaveCount(0)
  })
})

test.describe('Home navigation', () => {
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

  test('mounts only the visible Home shelf cards when navigating from Playlists', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await goTo(page, 'userplaylists')
    await page.evaluate(() => {
      window.navigationMaxHomeCards = 0
      // Include transient cards rendered before ResizeObserver measures the shelf.
      window.navigationHomeObserver = new MutationObserver(() => {
        const count = document.querySelectorAll('[data-home-section="newSinceLastVisit"] .mediaGrid li').length
        window.navigationMaxHomeCards = Math.max(window.navigationMaxHomeCards, count)
      })
      window.navigationHomeObserver.observe(document.querySelector('#app'), { childList: true, subtree: true })
    })
    try {
      for (const viewport of [{ width: 375, height: 700 }, { width: 700, height: 375 }]) {
        await page.setViewportSize(viewport)
        const elapsed = await page.evaluate(() => new Promise(resolve => {
          const startedAt = performance.now()
          document.querySelector('.sideNav a[href="#/home"]').click()
          function rendered() {
            if (document.querySelector('[data-home-section="newSinceLastVisit"] .mediaGrid li')) {
              requestAnimationFrame(() => resolve(performance.now() - startedAt))
            } else requestAnimationFrame(rendered)
          }
          requestAnimationFrame(rendered)
        }))
        console.log(`Home navigation (${viewport.width}px): ${elapsed.toFixed(1)} ms`)
        const shelf = page.locator('[data-home-section="newSinceLastVisit"]')
        await expect(shelf).toContainText('Video 0-0')
        expect(await page.evaluate(() => window.navigationMaxHomeCards)).toBeLessThanOrEqual(3)
        await shelf.getByRole('button', { name: 'Next New since last visit page' }).click()
        await expect(shelf.locator('[data-home-shelf-page="2"]')).toBeVisible()
        await goTo(page, 'userplaylists')
      }
    } finally {
      await page.evaluate(() => {
        window.navigationHomeObserver.disconnect()
        delete window.navigationHomeObserver
        delete window.navigationMaxHomeCards
      })
    }
  })
})
