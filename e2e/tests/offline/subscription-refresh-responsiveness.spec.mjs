import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { abortUnmockedRequest, test, expect, goTo } from '../../helpers/app.mjs'
import { parseBackgroundFeed } from '../../../src/renderer/helpers/api/background-feed-parser.js'

const channelCount = 40
const channels = Array.from({ length: channelCount }, (_, index) => ({
  id: `UC${String(index).padStart(22, '0')}`, name: `Channel ${index}`, thumbnail: ''
}))

const seed = {
  settings: {
    fetchSubscriptionsAutomatically: false,
    useRssFeeds: false,
    backendPreference: 'local',
    backendFallback: false,
    reducedMotion: 'off',
    uiScale: 95,
    showNewSubscriptionFeed: true,
    hideSubscriptionsShorts: true,
    hideSubscriptionsLive: true,
    hideSubscriptionsCommunity: true
  },
  profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: channels }]
}

const body = gunzipSync(await readFile(new URL('../../fixtures/innertube/channel/shows-channel-info-and-videos/browse-43cf009333cb.0.json.gz', import.meta.url))).toString('utf8')
// The first fetch establishes a baseline rather than marking old uploads new.
// Seed previously new entries before launch to exercise visible New-feed cards.
const [entry] = parseBackgroundFeed({ backgroundFormat: 'local', data: JSON.parse(body) }, 'videos', channels[0].id, '')
const subscriptionCache = channels.map((channel, index) => ({
  _id: channel.id,
  videos: [{ ...entry, authorId: channel.id, videoId: `${String(index).padStart(2, '0')}${entry.videoId.slice(2)}`, isNewInSubscriptionFeed: true }],
  videosTimestamp: '2026-01-01T00:00:00.000Z'
}))

for (const feed of ['videos', 'new']) {
  test.describe(`${feed} feed`, () => {
    test.use({ seed: { ...seed, subscriptionCache: feed === 'new' ? subscriptionCache : [] } })

    test(`keeps input tasks responsive during a large ${feed} subscription refresh on a slower CPU`, async ({ page }, testInfo) => {
      await page.route(/^https?:\/\//, abortUnmockedRequest)
      await page.route('**/youtubei/v1/browse**', route => {
        const index = Number(JSON.parse(route.request().postData()).browseId.slice(2))
        // Each channel must have distinct videos: duplicate Vue keys would measure
        // an invalid list instead of the normal subscription refresh.
        const response = JSON.parse(body, (key, value) => key === 'videoId' || key === 'contentId'
          ? `${String(index).padStart(2, '0')}${value.slice(2)}`
          : value)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
      })
      await goTo(page, 'subscriptions')
      if (feed === 'new') {
        await page.locator('[data-subscription-feed-tab="all"]').click()
        await expect(page.locator('#subscriptionsPanel .ft-list-video').first()).toBeVisible()
      }
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
      if (process.env.OPENTUBEX_REFRESH_CPU_PROFILE) {
        await cdp.send('Profiler.enable')
        await cdp.send('Profiler.start')
      }
      await page.evaluate(() => {
        window.__refreshLongTasks = []
        window.__refreshObserver = new PerformanceObserver(list => {
          window.__refreshLongTasks.push(...list.getEntries().map(entry => entry.duration))
        })
        window.__refreshObserver.observe({ type: 'longtask' })
      })
      await page.getByRole('button', { name: feed === 'new' ? /Refresh New content/ : /Refresh Videos/ }).click()
      await expect.poll(() => page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return Object.values(store.getters.getVideoCache).filter(cache => cache.count === 30).length
      }), { timeout: 30_000 }).toBe(channelCount)
      await expect(page.getByRole('button', { name: 'Cancel refresh' })).toHaveCount(0)
      await expect(page.locator('#subscriptionsPanel .ft-list-video').first()).toBeVisible()
      const metrics = await page.evaluate(() => {
        window.__refreshObserver.disconnect()
        return {
          durations: window.__refreshLongTasks,
          blockingMs: window.__refreshLongTasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0)
        }
      })
      if (process.env.OPENTUBEX_REFRESH_CPU_PROFILE) {
        const { profile } = await cdp.send('Profiler.stop')
        await testInfo.attach('refresh CPU profile', { body: JSON.stringify(profile), contentType: 'application/json' })
      }
      await cdp.detach()
      await testInfo.attach('subscription refresh responsiveness', { body: JSON.stringify(metrics), contentType: 'application/json' })
      // Allow the initial controls and final page of cards to render once, while
      // catching repeated redraws (over 10 seconds of blocking in this replay).
      expect(metrics.blockingMs, JSON.stringify(metrics)).toBeLessThan(1500)
    })
  })
}
