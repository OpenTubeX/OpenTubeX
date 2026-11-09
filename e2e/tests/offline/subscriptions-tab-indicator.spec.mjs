import { test, expect, goTo, sel } from '../../helpers/app.mjs'
import { expectTabHighlightAligned } from '../../helpers/tabs.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

function video (index, kind) {
  return {
    videoId: `${kind}${String(index).padStart(6, '0')}`,
    title: `${kind} video ${String(index).padStart(3, '0')}`,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    published: now - index * 3600000,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video'
  }
}

// Large feeds so that rendering a panel is expensive enough to stall the
// indicator animation when both happen in the same frame
const videos = Array.from({ length: 150 }, (_, index) => video(index, 'video'))
const shorts = Array.from({ length: 150 }, (_, index) => ({
  ...video(index, 'short'),
  thumbnailUrl: `https://i.ytimg.com/vi/short${index}/hq720_2.jpg?sqp=selected&rs=signature`
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false,
      showNewSubscriptionFeed: true,
      generalAutoLoadMorePaginatedItemsEnabled: false,
      reducedMotion: 'off',
      uiScale: 95
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
        videosTimestamp: new Date(now).toISOString(),
        shorts,
        shortsTimestamp: new Date(now).toISOString()
      }
    ]
  }
})

test.describe('subscriptions feed tab indicator', () => {
  test('falls back when the persisted tab is hidden on startup', async ({ page }) => {
    await page.evaluate(async () => {
      localStorage.setItem('Subscriptions/currentTab', 'videos')

      const store = window.$store
      await store.dispatch('updateHideSubscriptionsVideos', true)
    })

    await goTo(page, 'subscriptions')

    await expect(page.locator('[data-subscription-feed-tab="videos"]')).toHaveCount(0)
    await expect(page.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('short video 000')).toBeVisible()
  })

  test('defers hidden feed cache updates until it is activated', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    const retainedPanel = await page.locator('#subscriptionsPanel').elementHandle()

    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
    await page.evaluate(channelId => {
      const store = window.$store
      const replacement = {
        ...store.getters.getVideoCache[channelId].videos[0],
        videoId: 'background-update',
        title: 'Background update'
      }

      store.commit('updateVideoCacheByChannel', {
        channelId,
        entries: [replacement],
        timestamp: new Date()
      })
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
        detail: { tab: 'videos' }
      }))
    }, CHANNEL_ID)

    // Give a background refresh time to (wrongly) reach the retained panel.
    await page.waitForTimeout(600)
    expect(await retainedPanel.textContent()).not.toContain('Background update')

    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(page.getByText('Background update')).toBeVisible()
  })

  test('keeps the last clicked tab when switching back and forth quickly', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()

    // Both clicks happen in the same task, so the last activation must win.
    await page.evaluate(() => {
      document.querySelector('[data-subscription-feed-tab="shorts"]').click()
      document.querySelector('[data-subscription-feed-tab="videos"]').click()
    })

    // Let a stale Shorts activation land if it would.
    await page.waitForTimeout(400)

    await expect(page.locator('.tab.selectedTab')).toHaveText(/Videos/)
    await expect(page.getByText('video video 000')).toBeVisible()

    await expectTabHighlightAligned(page.locator('[data-subscription-feed-tab="videos"]'))
  })

  test('keeps feed scroll positions across microtask-separated switches', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    const videosScrollTop = await page.evaluate(() => window.scrollY)

    await page.evaluate(() => {
      document.querySelector('[data-subscription-feed-tab="shorts"]').click()
      queueMicrotask(() => {
        document.querySelector('[data-subscription-feed-tab="videos"]').click()
      })
    })

    await expect(page.locator('[data-subscription-feed-tab="videos"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(videosScrollTop)

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('keeps pagination limits separate between feed tabs', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const panelItems = page.locator('#subscriptionsPanel .autoGrid').first().locator(':scope > div')
    await expect(panelItems).toHaveCount(100)
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(panelItems).toHaveCount(150)

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(panelItems).toHaveCount(100)
    await expect(page.getByRole('button', { name: 'Load More Videos' })).toBeVisible()
  })

  test('restores the fallback feed scroll after a background visibility change', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'settings')
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateHideSubscriptionsVideos', true)
    })

    await page.locator(sel.tabs).first().click()
    const subscriptionsView = page.locator('.tabContent[aria-hidden="false"]')

    await expect(subscriptionsView.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(subscriptionsView.getByText('short video 000')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('keeps the panel hidden after every tab is hidden', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await page.evaluate(async () => {
      const store = window.$store

      document.querySelector('[data-subscription-feed-tab="shorts"]').click()
      await Promise.all([
        store.dispatch('updateHideSubscriptionsVideos', true),
        store.dispatch('updateHideSubscriptionsShorts', true),
        store.dispatch('updateHideSubscriptionsLive', true),
        store.dispatch('updateHideSubscriptionsCommunity', true)
      ])
    })

    await expect(page.locator('.tabs [role="tab"]')).toHaveCount(0)
    await expect(page.locator('#subscriptionsPanel')).toHaveCount(0)
    await expect(page.getByText('All subscription tabs are hidden', { exact: false })).toBeVisible()
  })
})
