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
    const measureRefresh = () => page.evaluate(async ({ feed, responses }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      // Replay fetched channel responses through the real cache IPC, persistence,
      // Vuex mutation and incremental-feed event, without network variability.
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
        seenVideoIsNew: (await window.ftElectron.libraryQuery('subscriptionPage', { subscriptions: [{ id: responses[0].channelId }], onlyNew: true, limit: 250 })).records.some(entry => entry.videoId === 'video-0-1'),
        updates: durations.length,
        medianUpdateMs: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)],
        p95SteadyTimerGapMs: steadyTimerGaps[Math.floor(steadyTimerGaps.length * 0.95)],
        maxTimerGapMs: timerGaps.at(-1)
      }
    }, { feed, responses: largeSubscriptionsSeed.subscriptionCache.slice(0, feed === 'shorts' ? 933 : 80).map(channel => ({ channelId: channel._id, videos: channel.videos })) })
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
    }
    if (feed !== 'shorts') await expect(page.getByText('Refreshed video 0-0', { exact: true })).toBeVisible()
    // The full-feed dependency scan took ~40 seconds for this replay. Leave
    // room for runner jitter while catching that repeated work reliably.
    expect(median('elapsedMs'), JSON.stringify(samples)).toBeLessThan(10_000)
    expect(median('medianUpdateMs'), JSON.stringify(samples)).toBeLessThan(500)
    expect(median('p95SteadyTimerGapMs'), JSON.stringify(samples)).toBeLessThan(125)
    // Publishing the whole feed once at completion may produce one longer gap.
    expect(median('maxTimerGapMs'), JSON.stringify(samples)).toBeLessThan(750)
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

    const metrics = await page.evaluate(async responses => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      responses[0].videos[0].title = 'Refreshed video 0-0'
      store.commit('setSubscriptionFeedRefreshInProgress', true)
      const started = performance.now()
      await store.dispatch('updateSubscriptionVideosCacheByChannel', responses[0])
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
        detail: { tab: 'videos' }
      }))
      // Wait beyond the paged feed's debounce/coalescing intervals so this
      // catches publication during refresh even on a fast renderer.
      await new Promise(resolve => setTimeout(resolve, 1250))
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
    }, largeSubscriptionsSeed.subscriptionCache.slice(0, 80).map((channel, channelIndex) => ({ channelId: channel._id, videos: channel.videos.map((video, videoIndex) => ({ ...video, liveNow: channelIndex !== 0 || videoIndex !== 0 })) })))

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

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSubscriptionFeedRefreshInProgress', true)
    await store.dispatch('updateHistory', {
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
    await store.dispatch('updateHistory', {
      videoId: 'video-0-0',
      isUpcoming: true,
      isWatched: true,
      premiereTimestamp: (timestamp + 60_000) / 1000,
      timeWatched: timestamp
    })
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
    const refresh = await page.evaluateHandle(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channelId = store.getters.getActiveProfile.subscriptions[0].id
      const videos = (await window.ftElectron.libraryQuery('subscriptionPage', { subscriptions: [{ id: channelId }], limit: 250 })).records
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

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channelId = store.getters.getActiveProfile.subscriptions[0].id
      const [first] = await window.ftElectron.libraryQuery('subscriptionEntries', { channelId, ids: ['video-0-0'] })
      const videos = [first, ...Array.from({ length: 5000 }, (_, index) => ({ ...first, videoId: `hidden-${index}`, isNewInSubscriptionFeed: false }))]
      videos[0].title = 'Pending large-cache update'
      await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos })
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', { detail: { tab: 'shorts' } }))
      await new Promise(resolve => setTimeout(resolve, 200))
    })
    // The new feed's cache has crossed the size threshold. Its updates wait.
    await expect(page.getByText('Finished Videos snapshot', { exact: true })).toBeVisible()
    await expect(page.getByText('Pending large-cache update', { exact: true })).toHaveCount(0)

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channelId = store.getters.getActiveProfile.subscriptions[0].id
      const videos = (await window.ftElectron.libraryQuery('subscriptionEntries', { channelId, ids: ['video-0-0'] }))
      await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos })
      store.commit('setSubscriptionFeedRefreshTab', 'live')
    })
    await expect(page.getByText('Pending large-cache update', { exact: true })).toBeVisible()

    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channelId = store.getters.getActiveProfile.subscriptions[0].id
      const [video] = await window.ftElectron.libraryQuery('subscriptionEntries', { channelId, ids: ['video-0-0'] })
      await store.dispatch('updateSubscriptionVideosCacheByChannel', {
        channelId, videos: [{ ...video, title: 'Incremental small-cache update' }]
      })
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', { detail: { tab: 'live' } }))
    })
    // Shrinking below the threshold restores coalesced incremental publication.
    await expect(page.getByText('Incremental small-cache update', { exact: true })).toBeVisible()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .commit('setSubscriptionFeedRefreshInProgress', false))
    await expect(page.getByText('Incremental small-cache update', { exact: true })).toBeVisible()
  })
})
