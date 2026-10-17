import { abortUnmockedRequest, test, expect, goTo } from '../../helpers/app.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'

test.use({
  seed: {
    ...largeSubscriptionsSeed,
    settings: {
      ...largeSubscriptionsSeed.settings,
      // Exercise synced seen-state filtering while channel responses arrive.
      subscriptionSeenVideos: JSON.stringify(Array.from({ length: 1880 }, (_, index) => ({
        videoId: index === 0 ? 'video-0-1' : `video-${Math.floor((index + 1) / 2)}-${(index + 1) % 2}`,
        seenAt: Date.now()
      }))),
      hideSubscriptionsShorts: false
    }
  }
})

test('updates watched state in the New feed during a large refresh', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="all"]').click()
  await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
  await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()

  await page.evaluate(() => {
    const store = window.$store
    store.commit('setSubscriptionFeedRefreshInProgress', true)
    store.commit('upsertToHistoryCache', {
      videoId: 'video-0-0',
      isWatched: true,
      timeWatched: Date.now()
    })
  })

  await expect(page.getByText('Video 0-0', { exact: true })).toHaveCount(0)
})

test('updates New feed sort preference during a large refresh', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="all"]').click()
  const firstEntry = page.locator('#subscriptionsPanel.newFeed .ft-list-video').first()
  await expect(firstEntry).toBeVisible()
  await expect(firstEntry).toContainText('Video 0-0')

  await page.evaluate(() => {
    const store = window.$store
    store.commit('setSubscriptionFeedRefreshInProgress', true)
    store.dispatch('updateNewSubscriptionFeedSortBy', 'oldest')
  })

  await expect(firstEntry).toContainText('Video 932-35')
})

test('rechecks premiere history after the clock advances and the Home feed recomputes', async ({ page }) => {
  const published = largeSubscriptionsSeed.subscriptionCache[0].videos[0].published
  await page.clock.setFixedTime(new Date(published))
  await page.evaluate(async timestamp => {
    const store = window.$store
    const history = {
      ...store.getters.getHistoryCacheById,
      'video-0-0': {
        videoId: 'video-0-0',
        isUpcoming: true,
        isWatched: true,
        premiereTimestamp: (timestamp + 60_000) / 1000
      }
    }
    store.commit('setHistoryCacheById', history)
  }, published)
  await goTo(page, 'home')
  await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()
  await page.clock.setFixedTime(new Date(published + 120_000))
  // An unrelated settings change recomputes the selector, but does not mutate
  // this channel's entries or history record.
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateOnlyShowLatestFromChannel', true)
  })
  await expect(page.getByText('Video 0-0', { exact: true })).toHaveCount(0)
})

test.describe('consecutive refreshes with a changing cache size', () => {
  test.use({
    seed: {
      ...largeSubscriptionsSeed,
      profiles: largeSubscriptionsSeed.profiles.map(profile => ({
        ...profile, subscriptions: profile.subscriptions.slice(0, 3)
      })),
      subscriptionCache: largeSubscriptionsSeed.subscriptionCache.slice(0, 3)
    }
  })

  test('updates the New snapshot and size gate when feeds change without going idle', async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()

    // Retain the pending promise while the large IPC payload triggers garbage collection.
    const refresh = await page.evaluateHandle(() => {
      const store = window.$store
      const [channelId, cache] = Object.entries(store.getters.getVideoCache)[0]
      const videos = JSON.parse(JSON.stringify(cache.videos))
      store.commit('setSubscriptionFeedRefreshTab', 'videos')
      store.commit('setSubscriptionFeedRefreshInProgress', true)
      return {
        finished: store.dispatch('updateSubscriptionVideosCacheByChannel', {
          channelId,
          videos: [
            { ...videos[0], title: 'Finished Videos snapshot' },
            ...Array.from({ length: 5000 }, (_, index) => ({
              ...videos[0], videoId: `hidden-${index}`, isNewInSubscriptionFeed: false
            }))
          ]
        }).then(() => {
          // A synchronized refresh can switch feeds without an idle state.
          store.commit('setSubscriptionFeedRefreshTab', 'shorts')
        })
      }
    })
    try {
      await refresh.evaluate(state => state.finished)
    } finally {
      await refresh.dispose()
    }
    await expect(page.getByText('Finished Videos snapshot', { exact: true })).toBeVisible()

    const updateFirstTitle = (title) => page.evaluate(async (title) => {
      const store = window.$store
      const [channelId, cache] = Object.entries(store.getters.getVideoCache)[0]
      const videos = JSON.parse(JSON.stringify(cache.videos))
      videos[0].title = title
      await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos })
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', { detail: { tab: 'shorts' } }))
    }, title)
    // The new feed's cache has crossed the size threshold. Its first refreshed
    // channel appears immediately, then updates wait for the next batch.
    await updateFirstTitle('First large-cache update')
    await expect(page.getByText('First large-cache update', { exact: true })).toBeVisible({ timeout: 1000 })
    await updateFirstTitle('Pending large-cache update')
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)))
    await expect(page.getByText('First large-cache update', { exact: true })).toBeVisible()
    await expect(page.getByText('Pending large-cache update', { exact: true })).toHaveCount(0)

    await page.evaluate(async () => {
      const store = window.$store
      const [channelId, cache] = Object.entries(store.getters.getVideoCache)[0]
      await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos: [cache.videos[0]] })
      store.commit('setSubscriptionFeedRefreshTab', 'live')
    })
    await expect(page.getByText('Pending large-cache update', { exact: true })).toBeVisible()

    await page.evaluate(async () => {
      const store = window.$store
      const [channelId, cache] = Object.entries(store.getters.getVideoCache)[0]
      await store.dispatch('updateSubscriptionVideosCacheByChannel', {
        channelId, videos: [{ ...cache.videos[0], title: 'Incremental small-cache update' }]
      })
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', { detail: { tab: 'live' } }))
    })
    // Shrinking below the threshold restores coalesced incremental publication.
    await expect(page.getByText('Incremental small-cache update', { exact: true })).toBeVisible()
    await page.evaluate(() => window.$store
      .commit('setSubscriptionFeedRefreshInProgress', false))
    await expect(page.getByText('Incremental small-cache update', { exact: true })).toBeVisible()
  })
})
