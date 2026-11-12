import { abortUnmockedRequest, test, expect, goTo, sel } from '../../helpers/app.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'

const HOUR = 3_600_000
const now = Date.now()

// The RSS refresh path is the one that can be driven without Innertube.
const commonSettings = {
  fetchSubscriptionsAutomatically: false,
  useRssFeeds: true,
  backendPreference: 'local',
  hideSubscriptionsShorts: true,
  hideSubscriptionsLive: true,
  thumbnailSize: 180
}

function channelId(index) {
  return `UC${String(index).padStart(22, '0')}`
}

function channelIndexFromUrl(url) {
  return Number(new URL(url).searchParams.get('playlist_id').match(/0*(\d+)$/)[1])
}

function rssFeed(index) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <author><name>Channel ${index}</name></author>
  <entry>
    <yt:videoId>fresh${index}</yt:videoId>
    <title>Fresh video ${index}</title>
    <published>${new Date(now - HOUR).toISOString()}</published>
    <media:group>
      <media:statistics views="1000"/>
    </media:group>
  </entry>
</feed>`
}

function rssFeedWithPreviousEntry(index) {
  return rssFeed(index).replace('</feed>', `
  <entry>
    <yt:videoId>cached${index}</yt:videoId>
    <title>Cached video ${index}</title>
    <published>${new Date(now - 2 * HOUR).toISOString()}</published>
    <media:group>
      <media:statistics views="1000"/>
    </media:group>
  </entry>
</feed>`)
}

function cachedChannel(index) {
  return {
    _id: channelId(index),
    videos: [{
      videoId: `cached${index}`,
      title: `Cached video ${index}`,
      author: `Channel ${index}`,
      authorId: channelId(index),
      published: now - (index + 2) * HOUR,
      viewCount: 1000,
      lengthSeconds: 120,
      liveNow: false,
      isUpcoming: false,
      type: 'video'
    }],
    videosTimestamp: new Date(now - 2 * HOUR).toISOString()
  }
}

function cachedVideoTitle(page, index) {
  return page.evaluate(id => {
    const store = window.$store
    return store.getters.getVideoCache[id]?.videos?.[0]?.title
  }, channelId(index))
}

function profileWith(channelCount) {
  return {
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions: Array.from({ length: channelCount }, (_, index) => ({
      id: channelId(index),
      name: `Channel ${index}`,
      thumbnail: ''
    }))
  }
}

function profileWithFilteredChannel() {
  const profile = profileWith(2)
  profile.subscriptions[1].feedTypes = []
  return profile
}

function profileWithDailyLimit(limit) {
  const profile = profileWith(1)
  profile.subscriptions[0].dailyVideoLimit = limit
  return profile
}

/**
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {(index: number) => number | Promise<number>} delayFor per channel response delay
 */
async function routeFeeds(page, delayFor, feedFor = rssFeed) {
  await page.route(/^https?:\/\//, abortUnmockedRequest)

  await page.route('**/feeds/videos.xml**', async (route, request) => {
    const index = channelIndexFromUrl(request.url())
    const delay = await delayFor(index)

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    // The window may already be gone when a delayed response arrives.
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      body: feedFor(index)
    }).catch(() => {})
  })
}

test.describe('per-channel subscription refresh filters', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        enableDownloads: true,
        ytDlpAutomaticDownloadRules: JSON.stringify({
          [channelId(1)]: { includeVideos: true }
        })
      },
      profiles: [profileWithFilteredChannel()],
      subscriptionCache: [cachedChannel(0), cachedChannel(1)]
    }
  })

  test('keeps automatic-download refreshes independent from feed visibility', async ({ page }) => {
    const requestedChannelIndexes = []
    page.on('request', request => {
      if (request.url().includes('/feeds/videos.xml')) {
        requestedChannelIndexes.push(channelIndexFromUrl(request.url()))
      }
    })
    await routeFeeds(page, () => 0)
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()
    await expect(page.getByText('Cached video 1', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
    await expect(page.getByText('Fresh video 1', { exact: true })).toHaveCount(0)

    expect(requestedChannelIndexes).toEqual([0, 1])
  })
})

test.describe('invalid per-channel daily video limit', () => {
  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profileWithDailyLimit(0)],
      subscriptionCache: [cachedChannel(0)]
    }
  })

  test('falls back to unlimited without suppressing the channel refresh', async ({ page }) => {
    const requestedChannelIndexes = []
    page.on('request', request => {
      if (request.url().includes('/feeds/videos.xml')) {
        requestedChannelIndexes.push(channelIndexFromUrl(request.url()))
      }
    })
    await routeFeeds(page, () => 0)
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect.poll(() => requestedChannelIndexes).toEqual([0])
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
  })
})

test.describe('incremental subscription feed refresh', () => {
  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profileWith(2)],
      subscriptionCache: [cachedChannel(0), cachedChannel(1)]
    }
  })

  test('shows fetched channels before the whole refresh is done', async ({ page }) => {
    await routeFeeds(page, (index) => index === 1 ? 8_000 : 0)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.locator('.tab.active .tabLoadingLine')).toHaveCount(0)

    // Channel 0 is done well before the pending channel 1, which keeps its
    // cached entry in the meantime
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible({ timeout: 3_000 })
    await expect(page.getByText('Fresh video 1', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Cached video 1', { exact: true })).toBeVisible()
    await expect(page.getByTestId('subscription-refresh-toast')).toBeVisible()
    await expect(page.locator('.tabsProgressBar')).toHaveCount(0)

    await expect(page.getByText('Fresh video 1', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.tab.active .tabLoadingLine')).toHaveCount(0)
  })

  test('defers incremental feed renders while its app tab is hidden', async ({ page }) => {
    await routeFeeds(page, (index) => index === 1 ? 8_000 : 2_000)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    const firstChannelResponse = page.waitForResponse((response) => {
      return response.url().includes('/feeds/videos.xml') &&
        channelIndexFromUrl(response.url()) === 0 &&
        response.ok()
    })
    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await page.locator(sel.newTabButton).click()
    // Navigating before the new tab is active would send the old tab to History.
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).last()).toHaveClass(/active/)
    await goTo(page, 'history')

    await firstChannelResponse
    const refreshProgress = page.getByTestId('subscription-refresh-toast')
      .locator('.progress-indicator')
    await expect.poll(async () => Number(await refreshProgress.getAttribute('data-progress')))
      .toBeGreaterThan(0)

    const hiddenSubscriptions = page.locator('.tabContent[aria-hidden="true"]')
    await expect(hiddenSubscriptions.getByText('Fresh video 0', { exact: true })).toHaveCount(0)
    await expect(hiddenSubscriptions.getByText('Cached video 0', { exact: true })).toHaveCount(1)

    await page.locator(sel.tabs).first().click()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible({ timeout: 3_000 })
  })
})

test.describe('subscription refresh with many tabs', () => {
  const channelCount = 933
  const tabCount = 46
  const loadedTabCount = 17
  const subscriptionTabId = 'perf-subscriptions'

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        startupBehavior: 'restoreTabLoadState',
        reducedMotion: 'off',
        subscriptionSeenVideos: JSON.stringify(Array.from({ length: 1880 }, (_, index) => ({
          videoId: `video-${Math.floor(index / 2)}-${index % 2}`,
          seenAt: Date.now()
        })))
      },
      profiles: [profileWith(channelCount)],
      subscriptionCache: largeSubscriptionsSeed.subscriptionCache,
      tabSessions: [{
        _id: 'perf-window-session',
        value: {
          tabs: Array.from({ length: tabCount }, (_, index) => ({
            id: index === 0 ? subscriptionTabId : `perf-tab-${index}`,
            url: index === 0
              ? 'app://bundle/index.html#/subscriptions'
              : 'app://bundle/index.html#/history',
            title: index === 0 ? 'Subscriptions' : `Background tab ${index}`,
            isUnloaded: index >= loadedTabCount
          })),
          activeTabId: subscriptionTabId,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }]
    }
  })

  test('shows channels fetched while a large refresh is still running', async ({ page }) => {
    test.setTimeout(120_000)
    await routeFeeds(page, index => index === 0 ? 0 : 8_000)
    await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible({ timeout: 5_000 })
    const cancelRefresh = page.getByRole('button', { name: 'Cancel refresh', exact: true })
    await expect(cancelRefresh).toBeVisible()
    await cancelRefresh.click()
  })

  test('shows channels fetched before a large refresh is cancelled', async ({ page }) => {
    test.setTimeout(120_000)
    await routeFeeds(page, index => index === 0 ? 0 : 8_000)
    await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible({ timeout: 30_000 })

    const firstChannelUpdated = page.evaluate(() => new Promise(resolve => {
      window.addEventListener('opentubex-subscription-refresh-channel', event => {
        if (event.detail.tab === 'videos') resolve()
      }, { once: true })
    }))
    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await firstChannelUpdated
    await page.getByRole('button', { name: 'Cancel refresh' }).click()
    await expect(page.getByRole('button', { name: 'Cancel refresh' })).toHaveCount(0)
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
  })
})

test.describe('subscription feed refresh controls', () => {
  const cachedShort = {
    videoId: 'cached-short',
    title: 'Cached short',
    author: 'Channel 0',
    authorId: channelId(0),
    published: now - HOUR,
    viewCount: 1000,
    lengthSeconds: 30,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    isNewInSubscriptionFeed: true
  }

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        hideSubscriptionsShorts: false,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profileWith(1)],
      subscriptionCache: [{
        ...cachedChannel(0),
        shorts: [cachedShort],
        shortsTimestamp: new Date(now - 2 * HOUR).toISOString()
      }]
    }
  })

  test('keeps Mark all as seen enabled while another feed refreshes', async ({ page }) => {
    await routeFeeds(page, () => 8_000)
    await goTo(page, 'subscriptions')

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.getByRole('button', { name: 'Cancel refresh' })).toBeVisible()
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeEnabled()
  })

  test.describe('tabbed New feed', () => {
    test.use({
      seed: {
        settings: {
          ...commonSettings,
          hideSubscriptionsShorts: false,
          hideSubscriptionsLive: false,
          showNewSubscriptionFeed: true,
          showNewSubscriptionFeedIndicators: true
        },
        profiles: [profileWith(1)],
        subscriptionCache: [{
          ...cachedChannel(0),
          videos: [{ ...cachedChannel(0).videos[0], isNewInSubscriptionFeed: true }],
          shorts: [cachedShort],
          shortsTimestamp: new Date(now - 2 * HOUR).toISOString(),
          liveStreams: [{ ...cachedShort, videoId: 'cached-live', title: 'Cached live', liveNow: true }],
          liveStreamsTimestamp: new Date(now - 2 * HOUR).toISOString()
        }]
      }
    })

    for (const feed of ['shorts', 'live']) {
      test(`keeps Mark all as seen enabled for New ${feed} while Videos refreshes`, async ({ page }) => {
        await page.route(/^https?:\/\//, abortUnmockedRequest)
        // Leave the refresh pending until the test window closes.
        const pendingRequest = page.waitForRequest('**/feeds/videos.xml**')
        await page.route('**/feeds/videos.xml**', () => {})
        await goTo(page, 'subscriptions')
        await page.getByRole('button', { name: /Refresh Videos/ }).click()
        await pendingRequest
        await page.locator('[data-subscription-feed-tab="all"]').click()
        const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
        await expect(markAllAsSeen).toBeDisabled()

        await page.getByRole('button', { name: 'Show tabbed view' }).click()
        await expect(markAllAsSeen).toBeDisabled()
        // Combined sections remain mounted during their leave animation.
        // Wait for removal before the tabbed list can render the same entry.
        await expect(page.locator('.newFeed .mediaSection, .newFeed .postsSection')).toHaveCount(0)
        await page.locator(`[data-new-feed-tab="${feed}"]`).click()
        const entry = page.getByText(feed === 'shorts' ? 'Cached short' : 'Cached live', { exact: true })
        await expect(entry).toHaveCount(1)
        await expect(entry).toBeVisible()
        await expect(markAllAsSeen).toBeEnabled({ timeout: 3_000 })
        await markAllAsSeen.click()
        await expect(entry).toHaveCount(0)
        await expect(markAllAsSeen).toHaveCount(0)
        await expect(page.getByTestId('subscription-refresh-toast')).toBeVisible()

        await page.locator('[data-new-feed-tab="videos"]').click()
        await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()
        await expect(markAllAsSeen).toBeDisabled()
      })
    }
  })
})

test.describe('seen state after a subscription feed refresh', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profileWith(1)],
      subscriptionCache: [cachedChannel(0)]
    }
  })

  test('updates the refreshed feed immediately when all entries are marked as seen', async ({ page }) => {
    await routeFeeds(page, () => 0, rssFeedWithPreviousEntry)
    await goTo(page, 'subscriptions')

    await page.getByRole('button', { name: /Refresh Videos/ }).click()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()

    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(markAllAsSeen).toBeVisible()
    await markAllAsSeen.click()

    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(markAllAsSeen).toHaveCount(0)
  })
})

test.describe('cancelling a subscription feed refresh', () => {
  // More channels than are fetched at once, so that the cancellation can skip
  // the ones that haven't started yet
  const channelCount = 12

  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profileWith(channelCount)],
      subscriptionCache: Array.from({ length: channelCount }, (_, index) => cachedChannel(index))
    }
  })

  test('stops a running refresh and keeps what was already fetched', async ({ page }) => {
    await routeFeeds(page, index => index === 0 ? 0 : 4_000)
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Cached video 0', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Refresh Videos/ }).click()

    const cancelRefresh = page.getByRole('button', { name: 'Cancel refresh' })
    await expect(cancelRefresh).toBeVisible()
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
    await cancelRefresh.click()

    // Completed channels stay cached; pending and queued channels are cancelled.
    await expect(page.locator('.tabsProgressBar')).toHaveCount(0, { timeout: 20_000 })
    await expect(cancelRefresh).toHaveCount(0)
    await expect(page.getByText('Fresh video 0', { exact: true })).toBeVisible()
    await expect(page.getByText(`Fresh video ${channelCount - 1}`, { exact: true })).toHaveCount(0)
    expect(await cachedVideoTitle(page, channelCount - 1)).toBe(`Cached video ${channelCount - 1}`)
  })
})

test.describe('cancelling an automatic subscription feed refresh', () => {
  const channelCount = 12
  /** @type {(delayFor: (index: number) => number) => void} */
  let chooseFeedDelays

  test.use({
    // A slow startup can start the automatic refresh before the test body
    // runs, and its feeds would reach unmocked endpoints. Route them from
    // launch and hold them until the test chooses their delays.
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a fixture object
    onPhase: async ({}, use) => {
      const chosen = new Promise(resolve => { chooseFeedDelays = resolve })
      await use(async (phase, _page, electronApp) => {
        if (phase === 'electronConnected') await routeFeeds(electronApp.context(), async index => (await chosen)(index))
      })
    },
    seed: {
      settings: {
        ...commonSettings,
        subscriptionFeedAutoRefreshInterval: '5000',
        showToastTimeoutIndicator: false,
        toastPosition: 'top-left'
      },
      profiles: [profileWith(channelCount)],
      subscriptionCache: Array.from({ length: channelCount }, (_, index) => cachedChannel(index))
    }
  })

  test('shows persistent progress in a toast without the global progress bar', async ({ page }) => {
    chooseFeedDelays((index) => index === 0 ? 0 : 8_000)
    await goTo(page, 'history')

    const refreshToast = page.getByTestId('subscription-refresh-toast')
    const progressToasts = page.locator('.persistent-stack')
    await expect(refreshToast).toContainText('Refreshing subscription videos', { timeout: 10_000 })
    await expect(refreshToast.locator('.icon')).toHaveAttribute('data-icon', 'video')
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)
    expect(await refreshToast.evaluate((toast) => {
      const { left, top, width, height } = toast.getBoundingClientRect()
      const hit = document.elementFromPoint(left + width / 2, top + height / 2)
      return hit !== null && !toast.contains(hit)
    })).toBe(true)

    const indicator = refreshToast.locator('.progress-indicator')
    await expect(indicator).toBeVisible()
    await expect.poll(async () => Number(await indicator.getAttribute('data-progress'))).toBeGreaterThan(0)
    expect(Number(await indicator.getAttribute('data-progress'))).toBeLessThan(100)

    const expandedBounds = await refreshToast.boundingBox()
    const tabBarBounds = await page.locator('.tabBar:not(.vertical)').boundingBox()
    expect(expandedBounds.y).toBeGreaterThanOrEqual(tabBarBounds.y + tabBarBounds.height)

    await page.mouse.move(expandedBounds.x + expandedBounds.width / 2, expandedBounds.y + expandedBounds.height / 2)
    await expect(progressToasts).toHaveClass(/minimized/)
    await expect.poll(async () => (await refreshToast.boundingBox()).width).toBeLessThan(expandedBounds.width * 0.6)

    const minimizedBounds = await refreshToast.boundingBox()
    expect(minimizedBounds.x).toBeLessThan(expandedBounds.x)
    expect(minimizedBounds.y).toBeCloseTo(expandedBounds.y, 0)
    expect(minimizedBounds.y).toBeGreaterThanOrEqual(tabBarBounds.y + tabBarBounds.height)

    await page.evaluate(() => {
      const store = window.$store
      store.commit('setVerticalTabBarWidth', 220)
      store.commit('setTabBarPosition', 'left')
    })
    const leftTabBar = page.locator('.tabBar.position-left')
    await expect(leftTabBar).toBeVisible()
    await expect(progressToasts).not.toHaveClass(/minimized/)
    const [shiftedBounds, leftTabBarBounds] = await Promise.all([
      refreshToast.boundingBox(),
      leftTabBar.boundingBox()
    ])
    expect(shiftedBounds.x).toBeGreaterThanOrEqual(leftTabBarBounds.x + leftTabBarBounds.width)

    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await expect(progressToasts).not.toHaveClass(/minimized/)
    await expect.poll(async () => (await refreshToast.boundingBox()).width).toBeGreaterThan(expandedBounds.width * 0.9)

    await page.evaluate(() => document.documentElement.requestFullscreen())
    await expect(refreshToast).toHaveCount(0)
    await page.evaluate(() => document.exitFullscreen())
    await expect(refreshToast).toBeVisible()

    await expect(refreshToast).toHaveCount(0, { timeout: 30_000 })
  })

  test('resets the timer instead of immediately refreshing again', async ({ page }) => {
    let requestCount = 0
    chooseFeedDelays(() => {
      requestCount++
      return 4_000
    })
    await goTo(page, 'subscriptions')

    const cancelRefresh = page.getByRole('button', { name: 'Cancel refresh' })
    await expect(cancelRefresh).toBeVisible({ timeout: 10_000 })
    await cancelRefresh.click()

    await expect(page.locator('.tabsProgressBar')).toHaveCount(0, { timeout: 20_000 })
    const requestCountAfterCancel = requestCount
    // No new refresh may start during this period.
    await page.waitForTimeout(2_000)

    expect(requestCountAfterCancel).toBeGreaterThan(0)
    expect(requestCount).toBe(requestCountAfterCancel)
    await expect(cancelRefresh).toHaveCount(0)
  })
})
