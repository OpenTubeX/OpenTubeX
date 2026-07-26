import { test, expect, goTo, sel } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

/**
 * Scroll to an exact offset. The feed fills in lazily, so on a loaded machine
 * the document can still be too short when we scroll, which silently clamps the
 * offset and fails the assertion. Wait for enough scrollable height first.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} top
 */
async function scrollFeedTo(page, top) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeGreaterThanOrEqual(top)

  await page.evaluate((offset) => window.scrollTo(0, offset), top)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top)
}

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
  await scrollFeedTo(page, 600)

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

test('a visible feed stays at the top while refreshed content is applied', async ({ page }) => {
  await expect(page.getByText('Feed video 00')).toBeVisible()
  await scrollFeedTo(page, 600)

  const displacedScroll = await page.evaluate(async () => {
    window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-completed', {
      detail: { tab: 'videos', profileId: 'allChannels', timestamp: Date.now() }
    }))

    // Browser scroll anchoring can adjust the offset during the next layout
    // frame, after the completion handler's immediate reset.
    await new Promise(resolve => window.requestAnimationFrame(resolve))
    window.scrollTo(0, 300)
    return window.scrollY
  })

  expect(displacedScroll).toBe(300)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})
