import { test, expect, goTo } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false,
      hideSubscriptionsLive: false,
      hideSubscriptionsCommunity: false,
      showNewSubscriptionFeed: true,
      useRssFeeds: false
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }
        ]
      }
    ]
  }
})

test('subscription tabs expose feed-specific reload actions', async ({ app, page }) => {
  await goTo(page, 'subscriptions')

  await app.electronApp.evaluate(({ Menu }) => {
    globalThis.__subscriptionContextMenus = []
    Menu.buildFromTemplate = (template) => {
      globalThis.__subscriptionContextMenus.push(template)
      return { popup () {} }
    }
  })

  const feedTabs = [
    { feedTab: 'videos', label: 'Reload Videos' },
    { feedTab: 'shorts', label: 'Reload Shorts' },
    { feedTab: 'live', label: 'Reload Live' },
    { feedTab: 'posts', label: 'Reload Posts' },
    { feedTab: 'all', label: 'Reload All Feeds' }
  ]

  for (const [index, { feedTab, label }] of feedTabs.entries()) {
    await page.locator(`[data-subscription-feed-tab="${feedTab}"]`).click({ button: 'right' })

    await expect.poll(async () => {
      return await app.electronApp.evaluate((_, menuIndex) => {
        const menu = globalThis.__subscriptionContextMenus[menuIndex]
        const reloadItem = menu && menu.find(item => item.label && item.label.startsWith('Reload'))
        return reloadItem && reloadItem.label
      }, index)
    }).toBe(label)
  }

  // Unmount Subscriptions so invoking the captured actions only exercises the
  // context-menu IPC path instead of starting real network refreshes offline.
  await goTo(page, 'history')
  await expect(page.locator('[data-subscription-feed-tab]')).toHaveCount(0)

  await page.evaluate(() => {
    window.__subscriptionFeedReloadRequests = []
    window.__removeSubscriptionFeedReloadListener = window.ftElectron.subscriptionFeeds.onRequestReload((payload) => {
      window.__subscriptionFeedReloadRequests.push(payload)
    })
  })

  for (let index = 0; index < feedTabs.length; index++) {
    await app.electronApp.evaluate((_, menuIndex) => {
      globalThis.__subscriptionContextMenus[menuIndex]
        .find(item => item.label && item.label.startsWith('Reload'))
        .click()
    }, index)
  }

  await expect.poll(async () => {
    return await page.evaluate(() => window.__subscriptionFeedReloadRequests)
  }).toEqual(feedTabs.map(({ feedTab }) => expect.objectContaining({
    feedTab,
    tabId: expect.any(String)
  })))

  await page.evaluate(() => window.__removeSubscriptionFeedReloadListener())
})
