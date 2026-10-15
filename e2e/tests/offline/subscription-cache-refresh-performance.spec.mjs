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
    const measureRefresh = () => page.evaluate(async (feed) => {
      const store = window.$store
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
      // Let the initial snapshot and refresh controls paint before measuring
      // steady per-channel updates; completion remains part of the timed run.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
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
      // Count whole-feed sorts: per-channel updates must not rebuild the feed.
      const feedSorts = { steady: 0, final: 0 }
      const originalSort = Array.prototype.sort
      const originalToSorted = Array.prototype.toSorted
      const countSort = length => { if (length >= 1000) feedSorts[publishingFinalUpdate ? 'final' : 'steady']++ }
      // eslint-disable-next-line no-extend-native
      Array.prototype.sort = function (...args) { countSort(this.length); return originalSort.apply(this, args) }
      // eslint-disable-next-line no-extend-native
      Array.prototype.toSorted = function (...args) { countSort(this.length); return originalToSorted.apply(this, args) }
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
      // eslint-disable-next-line no-extend-native
      Array.prototype.sort = originalSort
      // eslint-disable-next-line no-extend-native
      Array.prototype.toSorted = originalToSorted
      timerGaps.sort((a, b) => a - b)
      steadyTimerGaps.sort((a, b) => a - b)
      return {
        elapsedMs,
        seenVideoIsNew: store.getters.getVideoCache[responses[0].channelId].videos[1].isNewInSubscriptionFeed,
        updates: durations.length,
        medianUpdateMs: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)],
        p95SteadyTimerGapMs: steadyTimerGaps[Math.floor(steadyTimerGaps.length * 0.95)],
        maxTimerGapMs: timerGaps.at(-1),
        feedSorts
      }
    }, feed)
    // Use repeated measurements for this timing benchmark so one host
    // scheduling spike cannot decide its steady-state responsiveness result.
    const samples = []
    for (let sample = 0; sample < 3; sample++) samples.push(await measureRefresh())
    const median = key => samples.map(sample => sample[key]).sort((a, b) => a - b)[1]
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop')
      await cdp.detach()
      await testInfo.attach('refresh CPU profile', {
        body: JSON.stringify(profile), contentType: 'application/json'
      })
    }
    await testInfo.attach('refresh timings', {
      body: JSON.stringify(samples), contentType: 'application/json'
    })
    for (const sample of samples) {
      expect(sample.updates).toBe(feed === 'shorts' ? 933 : 80)
      expect(sample.seenVideoIsNew).toBe(false)
      // Publishing the whole feed once at completion may sort it once.
      expect(sample.feedSorts.steady, JSON.stringify(samples)).toBe(0)
      expect(sample.feedSorts.final, JSON.stringify(samples)).toBeLessThanOrEqual(1)
    }
    if (feed !== 'shorts') await expect(page.getByText('Refreshed video 0-0', { exact: true })).toBeVisible()
    // Gross hang bound: the full-feed dependency scan took ~40 seconds for this replay.
    expect(median('elapsedMs'), JSON.stringify(samples)).toBeLessThan(15_000)
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
      const store = window.$store
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
      // The visible feed must not publish the update during this period.
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
    // Gross hang bound only.
    expect(metrics.elapsed).toBeLessThan(15_000)
    await expect(page.getByText('Refreshed video 0-0', { exact: true })).toBeVisible()
  })
})
