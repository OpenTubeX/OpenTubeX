import { test, expect, goTo, sel, setWindowSize } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

/**
 * Scroll to an offset within one physical pixel. The feed fills in lazily, so on a loaded machine
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
  await expect.poll(() => page.evaluate(offset => Math.abs(window.scrollY - offset) * devicePixelRatio, top)).toBeLessThanOrEqual(1)
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
  type: 'video',
  isNewInSubscriptionFeed: true
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

for (const uiScale of [100, 95]) {
  test(`mobile header hides fully and returns on a deliberate upward scroll at ${uiScale}% scale`, async ({ app, page, attachScreenshot }) => {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100)
    }, uiScale)
    await setWindowSize(app, page, { width: 375, height: 700 })
    await expect(page.getByText('Feed video 00')).toBeVisible()
    await page.evaluate(() => document.activeElement.blur())

    const header = page.locator('.subscriptionsHeader')
    const headerBottom = () => header.evaluate(element => element.getBoundingClientRect().bottom)
    const headerTop = () => header.evaluate(element => element.getBoundingClientRect().top)
    const stickyOffset = () => header.evaluate(element => Number.parseFloat(getComputedStyle(element).top))

    await scrollFeedTo(page, 600)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await attachScreenshot(`mobile header hidden at ${uiScale}%`)

    // Stay deep in the feed: changing tabs must not require returning to its top.
    await scrollFeedTo(page, 580)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await scrollFeedTo(page, 530)
    await expect.poll(async () => Math.abs(await headerTop() - await stickyOffset())).toBeLessThanOrEqual(1)
    await attachScreenshot(`mobile header revealed at ${uiScale}%`)

    await scrollFeedTo(page, 620)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await scrollFeedTo(page, 0)
    await expect.poll(headerTop).toBeGreaterThanOrEqual(await stickyOffset() - 1)

    await setWindowSize(app, page, { width: 640, height: 375 })
    await scrollFeedTo(page, 600)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await scrollFeedTo(page, 580)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await scrollFeedTo(page, 530)
    await expect.poll(async () => Math.abs(await headerTop() - await stickyOffset())).toBeLessThanOrEqual(1)

    // A hidden phone header must become sticky again after resizing to desktop.
    await scrollFeedTo(page, 600)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await setWindowSize(app, page, { width: 1600, height: 900 })
    await expect(header).toHaveClass(/singleRow/)
    // The header and video grid finish reflowing after the window bounds change.
    // Let scroll anchoring settle before setting the desktop scroll offset.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await scrollFeedTo(page, 600)
    await expect.poll(async () => Math.abs(await headerTop() - await stickyOffset())).toBeLessThanOrEqual(1)
    await scrollFeedTo(page, 650)
    await expect.poll(async () => Math.abs(await headerTop() - await stickyOffset())).toBeLessThanOrEqual(1)
  })
}

for (const uiScale of [100, 95]) {
  test(`landscape phone header hides and requires a longer upward scroll at ${uiScale}% scale`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100)
    }, uiScale)
    await setWindowSize(app, page, { width: 844, height: 390 })
    await expect(page.getByText('Feed video 00')).toBeVisible()
    await page.evaluate(() => document.activeElement.blur())

    const header = page.locator('.subscriptionsHeader')
    const headerBottom = () => header.evaluate(element => element.getBoundingClientRect().bottom)
    await expect(header).toHaveCSS('transition-duration', '0.28s')
    await scrollFeedTo(page, 600)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await expect(header).toHaveCSS('transition-duration', '0.22s')
    await scrollFeedTo(page, 580)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await scrollFeedTo(page, 540)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
    await scrollFeedTo(page, 530)
    await expect.poll(() => header.evaluate(element => {
      return Math.abs(element.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(element).top))
    })).toBeLessThanOrEqual(1)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(header).toHaveCSS('transition-duration', '0s')
    await scrollFeedTo(page, 600)
    await expect.poll(headerBottom).toBeLessThanOrEqual(0)
  })
}

test('mobile header keeps focused controls visible and hides the taller New feed in reduced motion', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 700 })
  await expect(page.getByText('Feed video 00')).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'reduce')

  const header = page.locator('.subscriptionsHeader')
  const videosTab = page.locator('[data-subscription-feed-tab="videos"]')
  await page.keyboard.press('Tab')
  await videosTab.focus()
  await scrollFeedTo(page, 600)
  await expect(videosTab).toBeInViewport()

  await page.evaluate(() => document.activeElement.blur())
  await scrollFeedTo(page, 640)
  await expect.poll(() => header.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0)
  await videosTab.focus()
  await expect(videosTab).toBeInViewport()

  await page.locator('[data-subscription-feed-tab="all"]').click()
  await page.getByRole('button', { name: 'Show tabbed view' }).click()
  await expect(page.locator('[data-new-feed-tab="videos"]')).toBeInViewport()
  await page.evaluate(() => document.activeElement.blur())
  await scrollFeedTo(page, 600)
  await expect.poll(() => header.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0)
  await expect(header).toHaveCSS('transition-duration', '0s')
  await scrollFeedTo(page, 530)
  await expect(page.locator('[data-new-feed-tab="videos"]')).toBeInViewport()
  await page.locator('[data-subscription-feed-tab="videos"]').click()
  await expect(videosTab).toBeInViewport()
})
