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

for (const feed of ['videos', 'new', 'shorts']) {
  test(`refreshes cached channels efficiently with the ${feed} feed visible`, async ({ page }, testInfo) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await goTo(page, 'subscriptions')
    await page.locator(`[data-subscription-feed-tab="${feed === 'new' ? 'all' : feed}"]`).click()
    if (feed === 'new') await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
    else await expect(page.locator('#subscriptionsPanel:not(.newFeed)')).toBeVisible()
    if (feed !== 'shorts') await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()

    const cdp = process.env.OPENTUBEX_REFRESH_CPU_PROFILE
      ? await page.context().newCDPSession(page)
      : null
    if (cdp) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.start')
    }
    const metrics = await page.evaluate(async (feed) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      // Replay fetched channel responses through the real cache IPC, persistence,
      // Vuex mutation and incremental-feed event, without network variability.
      const responses = Object.entries(store.getters.getVideoCache).slice(0, feed === 'shorts' ? 933 : 80)
        .map(([channelId, cache]) => ({
          channelId,
          videos: JSON.parse(JSON.stringify(cache.videos))
        }))
      responses[0].videos[0].title = 'Refreshed video 0-0'
      // Remote responses do not know about this device's synced seen marks.
      responses[0].videos[1].isNewInSubscriptionFeed = true
      store.commit('setSubscriptionFeedRefreshInProgress', true)
      const durations = []
      const timerGaps = []
      const steadyTimerGaps = []
      let publishingFinalUpdate = false
      let previousTick = performance.now()
      const timer = setInterval(() => {
        const now = performance.now()
        const gap = now - previousTick
        timerGaps.push(gap)
        if (!publishingFinalUpdate) steadyTimerGaps.push(gap)
        previousTick = now
      }, 16)
      let next = 0
      const started = performance.now()
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < responses.length) {
          const response = responses[next++]
          const before = performance.now()
          await store.dispatch('updateSubscriptionVideosCacheByChannel', response)
          durations.push(performance.now() - before)
          window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
            detail: { tab: 'videos' }
          }))
          await new Promise(resolve => setTimeout(resolve, 20))
        }
      }))
      publishingFinalUpdate = true
      store.commit('setSubscriptionFeedRefreshInProgress', false)
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
        detail: { tab: 'videos' }
      }))
      await new Promise(resolve => setTimeout(resolve, 120))
      await new Promise(resolve => requestAnimationFrame(resolve))
      const elapsedMs = performance.now() - started
      clearInterval(timer)
      timerGaps.sort((a, b) => a - b)
      steadyTimerGaps.sort((a, b) => a - b)
      return {
        elapsedMs,
        seenVideoIsNew: store.getters.getVideoCache[responses[0].channelId].videos[1].isNewInSubscriptionFeed,
        updates: durations.length,
        medianUpdateMs: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)],
        p95SteadyTimerGapMs: steadyTimerGaps[Math.floor(steadyTimerGaps.length * 0.95)],
        maxTimerGapMs: timerGaps.at(-1)
      }
    }, feed)
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop')
      await cdp.detach()
      await testInfo.attach('refresh CPU profile', {
        body: JSON.stringify(profile), contentType: 'application/json'
      })
    }
    await testInfo.attach('refresh timings', {
      body: JSON.stringify(metrics), contentType: 'application/json'
    })
    expect(metrics.updates).toBe(feed === 'shorts' ? 933 : 80)
    expect(metrics.seenVideoIsNew).toBe(false)
    if (feed !== 'shorts') await expect(page.getByText('Refreshed video 0-0', { exact: true })).toBeVisible()
    // The full-feed dependency scan took ~40 seconds for this replay. Leave
    // room for runner jitter while catching that repeated work reliably.
    expect(metrics.elapsedMs, JSON.stringify(metrics)).toBeLessThan(10_000)
    expect(metrics.medianUpdateMs, JSON.stringify(metrics)).toBeLessThan(500)
    expect(metrics.p95SteadyTimerGapMs, JSON.stringify(metrics)).toBeLessThan(125)
    // Publishing the whole feed once at completion may produce one longer gap.
    expect(metrics.maxTimerGapMs, JSON.stringify(metrics)).toBeLessThan(750)
  })
}

test.describe('large cached feed with most entries hidden', () => {
  test.use({
    seed: {
      ...largeSubscriptionsSeed,
      settings: {
        ...largeSubscriptionsSeed.settings,
        hideLiveStreams: true
      },
      subscriptionCache: largeSubscriptionsSeed.subscriptionCache.map((channel, channelIndex) => ({
        ...channel,
        videos: channel.videos.map((video, videoIndex) => ({
          ...video,
          liveNow: channelIndex !== 0 || videoIndex !== 0
        }))
      }))
    }
  })

  test('defers rebuilding cached videos while channel responses arrive', async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()

    const metrics = await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const responses = Object.entries(store.getters.getVideoCache).slice(0, 80)
        .map(([channelId, cache]) => ({
          channelId,
          videos: JSON.parse(JSON.stringify(cache.videos))
        }))
      responses[0].videos[0].title = 'Refreshed video 0-0'
      store.commit('setSubscriptionFeedRefreshInProgress', true)
      const started = performance.now()
      await store.dispatch('updateSubscriptionVideosCacheByChannel', responses[0])
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
        detail: { tab: 'videos' }
      }))
      await new Promise(resolve => setTimeout(resolve, 200))
      const updatedDuringRefresh = document.body.textContent.includes('Refreshed video 0-0')
      for (const response of responses.slice(1)) {
        await store.dispatch('updateSubscriptionVideosCacheByChannel', response)
        window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
          detail: { tab: 'videos' }
        }))
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      const elapsed = performance.now() - started
      store.commit('setSubscriptionFeedRefreshInProgress', false)
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
        detail: { tab: 'videos' }
      }))
      return { elapsed, updatedDuringRefresh }
    })

    expect(metrics.updatedDuringRefresh).toBe(false)
    expect(metrics.elapsed).toBeLessThan(10_000)
    await expect(page.getByText('Refreshed video 0-0', { exact: true })).toBeVisible()
  })
})

test('updates watched state in the New feed during a large refresh', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="all"]').click()
  await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
  await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSubscriptionFeedRefreshInProgress', true)
    store.dispatch('updateNewSubscriptionFeedSortBy', 'oldest')
  })

  await expect(firstEntry).toContainText('Video 932-35')
})

test('rechecks premiere history after the clock advances and the Home feed recomputes', async ({ page }) => {
  const published = largeSubscriptionsSeed.subscriptionCache[0].videos[0].published
  await page.clock.setFixedTime(new Date(published))
  await page.evaluate(async timestamp => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateOnlyShowLatestFromChannel', true)
  })
  await expect(page.getByText('Video 0-0', { exact: true })).toHaveCount(0)
})
