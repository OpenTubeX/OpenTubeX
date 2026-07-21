import { test, expect, goTo, sel } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

const videos = Array.from({ length: 80 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `Feed video ${String(index).padStart(2, '0')}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3600000,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  isUpcoming: false,
  type: 'video'
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      rememberTabNavigationHistory: true
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_ID,
        videos,
        videosTimestamp: new Date(now).toISOString()
      }
    ]
  }
})

test('a background feed refresh resets its logical tab scroll across restart', async ({ app, page }) => {
  await expect(page.getByText('Feed video 00')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 600))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)

  const subscriptionsTabId = await page.locator(sel.tabs).first().getAttribute('data-tab-id')
  await page.locator(sel.newTabButton).click()
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await goTo(page, 'settings')

  // Reproduce a subscriptions offset that has already been saved to the app
  // session, so the refresh must also replace its persisted value.
  await page.evaluate((tabId) => {
    window.ftElectron.tabs.updateNavigationHistory({
      tabId,
      history: [{
        route: { path: '/subscriptions', fullPath: '/subscriptions' },
        title: 'Subscriptions',
        scroll: { left: 0, top: 600 }
      }],
      historyIndex: 0
    })
  }, subscriptionsTabId)
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    const tab = state.tabs.find(candidate => candidate.id === subscriptionsTabId)
    return tab && tab.history ? tab.history[0].scroll.top : null
  }).toBe(600)

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-completed', {
      detail: { tab: 'videos', profileId: 'allChannels', timestamp: Date.now() }
    }))
  })

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    const tab = state.tabs.find(candidate => candidate.id === subscriptionsTabId)
    return tab && tab.history ? tab.history[0].scroll.top : null
  }).toBe(0)

  await page.locator(sel.tabs).first().click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  const relaunched = await app.relaunch()
  await expect(relaunched.page.getByText('Feed video 00')).toBeVisible()
  await expect.poll(() => relaunched.page.evaluate(() => window.scrollY)).toBe(0)
})
