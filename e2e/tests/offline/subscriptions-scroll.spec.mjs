import { abortUnmockedRequest, test, expect, goTo, sel, setWindowSize } from '../../helpers/app.mjs'

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
  // Deliver the scroll event before assertions about the header's visibility.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
}

/** Applies the refresh completion signal and waits for its deferred layout work. */
async function completeFeedRefresh(page, tab = 'videos', trigger = 'completion event') {
  return page.evaluate(async ({ tab, trigger }) => {
    if (trigger === 'completion event') {
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-completed', {
        detail: { tab, profileId: 'allChannels', timestamp: Date.now() }
      }))
    } else {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSubscriptionFeedLastRefreshTimestamp', Date.now())
    }
    for (let frame = 0; frame < 5; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return { top: window.scrollY, pixelRatio: devicePixelRatio }
  }, { tab, trigger })
}

async function routeFeed(page, entries, beforeResponse = () => {}) {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('**/feeds/videos.xml**', async route => {
    await beforeResponse()
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
          <author><name>Channel A</name></author>
          ${entries.map(video => `<entry>
            <yt:videoId>${video.videoId}</yt:videoId>
            <title>${video.title}</title>
            <published>${new Date(video.published).toISOString()}</published>
            <media:group><media:statistics views="2000"/></media:group>
          </entry>`).join('')}
        </feed>`
    })
  })
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
      useRssFeeds: true,
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

test('a background feed refresh preserves its logical tab scroll across restart', async ({ app, page }) => {
  await expect(page.getByText('Feed video 00')).toBeVisible()
  await scrollFeedTo(page, 600)

  const subscriptionsTabId = await page.locator(sel.tabs).first().getAttribute('data-tab-id')
  await page.locator(sel.newTabButton).click()
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await goTo(page, 'settings')

  // Reproduce a subscriptions offset that has already been saved to the app
  // session, so the refresh must also preserve its persisted value.
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

  await completeFeedRefresh(page)

  await expect.poll(async () => {
    const state = await page.evaluate(() => window.ftElectron.tabs.getState())
    const tab = state.tabs.find(candidate => candidate.id === subscriptionsTabId)
    return tab && tab.history ? tab.history[0].scroll.top : null
  }).toBe(600)

  await page.locator(sel.tabs).first().click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)

  const relaunched = await app.relaunch()
  // The restored viewport can leave the first video unmounted above it.
  await expect(relaunched.page.locator('.ft-list-video .title').first()).toContainText('Feed video')
  await expect.poll(async () => {
    const state = await relaunched.page.evaluate(() => window.ftElectron.tabs.getState())
    const tab = state.tabs.find(candidate => candidate.id === subscriptionsTabId)
    return tab?.history?.[0].scroll.top
  }).toBe(600)
  // Startup header reflow can anchor the viewport slightly above the saved
  // offset. The persisted position must survive and the feed must stay scrolled.
  await expect.poll(() => relaunched.page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
})

for (const [trigger, uiScale] of [
  ['completion event', 100],
  ['completion event', 95],
  ['refresh timestamp', 100]
]) {
  test(`a visible mobile feed preserves its scroll after a ${trigger} at ${uiScale}% scale`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100)
    }, uiScale)
    await setWindowSize(app, page, { width: 375, height: 700 })
    await expect(page.getByText('Feed video 00')).toBeVisible()
    await scrollFeedTo(page, 600)

    const scroll = await completeFeedRefresh(page, 'videos', trigger)
    expect(Math.abs(scroll.top - 600) * scroll.pixelRatio).toBeLessThanOrEqual(1)
  })
}

test('every feed refresh preserves the visible New feed position', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 700 })
  await expect(page.getByText('Feed video 00')).toBeVisible()
  await page.locator('[data-subscription-feed-tab="all"]').click()
  await expect(page.locator('[data-subscription-feed-tab="all"]')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await scrollFeedTo(page, 800)
  for (const tab of ['videos', 'shorts', 'live', 'posts']) {
    const scroll = await completeFeedRefresh(page, tab)
    expect(scroll.top).toBe(800)
  }
})

test('finishing a refresh keeps the position reached while scrolling the mobile feed', async ({ app, page }) => {
  await setWindowSize(app, page, { width: 375, height: 700 })
  await expect(page.getByText('Feed video 00')).toBeVisible()
  const response = Promise.withResolvers()
  const requested = Promise.withResolvers()
  await routeFeed(page, videos, async () => {
    requested.resolve()
    await response.promise
  })
  await page.getByRole('button', { name: /Refresh Videos/ }).click()
  await requested.promise
  await scrollFeedTo(page, 600)
  response.resolve()
  await expect(page.getByRole('button', { name: 'Cancel refresh' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(async ({ channelId, videoId }) => (await window.ftElectron.libraryQuery('subscriptionEntries', { channelId, ids: [videoId] }))[0]?.viewCount, { channelId: CHANNEL_ID, videoId: videos[0].videoId })).toBe(2000)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
})

for (const uiScale of [100, 95]) {
  for (const remainingCount of [3, 0]) {
    test(`a refresh with ${remainingCount} videos clamps the feed and updates its scrollbar at ${uiScale}% scale`, async ({ app, page }) => {
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100)
      }, uiScale)
      await setWindowSize(app, page, { width: 375, height: 700 })
      await expect(page.getByText('Feed video 00')).toBeVisible()
      const response = Promise.withResolvers()
      const requested = Promise.withResolvers()
      await routeFeed(page, videos.slice(0, remainingCount), async () => {
        requested.resolve()
        await response.promise
      })
      await page.getByRole('button', { name: /Refresh Videos/ }).click()
      await requested.promise
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
      response.resolve()
      await expect.poll(() => page.evaluate(channelId => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return store.getters.getVideoCache[channelId]?.count
      }, CHANNEL_ID)).toBe(remainingCount)
      await expect(page.getByRole('button', { name: 'Cancel refresh' })).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => {
        return Math.abs(window.scrollY - Math.max(0, document.documentElement.scrollHeight - innerHeight)) * devicePixelRatio
      })).toBeLessThanOrEqual(2)
      const scrollbar = page.locator('body > .os-scrollbar-vertical')
      if (remainingCount === 0) {
        await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      } else {
        await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
        await expect.poll(() => scrollbar.evaluate(element => {
          const handle = element.querySelector('.os-scrollbar-handle').getBoundingClientRect()
          const track = element.querySelector('.os-scrollbar-track').getBoundingClientRect()
          return Math.abs(handle.bottom - track.bottom) * devicePixelRatio
        })).toBeLessThanOrEqual(2)
      }
    })
  }
}

for (const uiScale of [100, 95]) {
  for (const [layout, size] of [
    ['portrait', { width: 375, height: 700 }],
    ['landscape', { width: 844, height: 390 }]
  ]) {
    test(`mobile header waits until its space leaves the viewport in ${layout} at ${uiScale}% scale`, async ({ app, page }) => {
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale / 100)
      }, uiScale)
      await setWindowSize(app, page, size)
      await expect(page.getByText('Feed video 00')).toBeVisible()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const header = page.locator('.subscriptionsHeader')

      for (const feed of ['videos', 'new']) {
        if (feed === 'new') {
          await page.locator('[data-subscription-feed-tab="all"]').click()
          await page.getByRole('button', { name: 'Show tabbed view' }).click()
        }
        await page.evaluate(() => document.activeElement.blur())
        await scrollFeedTo(page, 0)
        const boundary = await header.evaluate(element => {
          return element.nextElementSibling.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(element).top)
        })
        expect(boundary).toBeGreaterThan(32)

        await scrollFeedTo(page, 32)
        await expect(header).not.toHaveClass(/scrollHidden/)
        await scrollFeedTo(page, boundary - 8)
        await expect(header).not.toHaveClass(/scrollHidden/)
        await scrollFeedTo(page, boundary + 16)
        await expect(header).toHaveClass(/scrollHidden/)
        await expect.poll(() => header.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0)
        const gap = await header.evaluate(element => {
          return element.nextElementSibling.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(element).top)
        })
        expect(gap).toBeLessThanOrEqual(1)

        // Returning to the header's original space must reveal it immediately.
        await scrollFeedTo(page, boundary - 8)
        await expect(header).not.toHaveClass(/scrollHidden/)
        await scrollFeedTo(page, 0)
      }
    })
  }

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
