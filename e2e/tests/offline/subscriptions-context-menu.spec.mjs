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

test('subscription tabs expose feed-specific reload actions', async ({ page }) => {
  // The reload actions start real refreshes, which fail immediately offline
  await page.route(/^https?:\/\//, (route) => route.abort())
  await goTo(page, 'subscriptions')

  await page.evaluate(() => {
    window.__subscriptionFeedReloadRequests = []
    window.__removeSubscriptionFeedReloadListener = window.ftElectron.subscriptionFeeds.onRequestReload((payload) => {
      window.__subscriptionFeedReloadRequests.push(payload)
    })
  })

  const feedTabs = [
    { feedTab: 'videos', label: 'Reload Videos' },
    { feedTab: 'shorts', label: 'Reload Shorts' },
    { feedTab: 'live', label: 'Reload Live' },
    { feedTab: 'posts', label: 'Reload Posts' },
    { feedTab: 'all', label: 'Reload All Feeds' }
  ]

  for (const [index, { feedTab, label }] of feedTabs.entries()) {
    // While a refresh is running the entry cancels it instead of reloading
    await expect(page.locator('.tabLoadingIndicator')).toHaveCount(0, { timeout: 30_000 })

    await page.locator(`[data-subscription-feed-tab="${feedTab}"]`).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context menu' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: label }).click()

    await expect.poll(async () => {
      return await page.evaluate(() => window.__subscriptionFeedReloadRequests.length)
    }).toBe(index + 1)
  }

  await expect.poll(async () => {
    return await page.evaluate(() => window.__subscriptionFeedReloadRequests)
  }).toEqual(feedTabs.map(({ feedTab }) => expect.objectContaining({
    feedTab,
    tabId: expect.any(String)
  })))

  await page.evaluate(() => window.__removeSubscriptionFeedReloadListener())
})

test('disabled context menu actions cannot execute through IPC', async ({ page }) => {
  const searchInput = page.locator('.searchInput input')
  await searchInput.fill('selection')
  await searchInput.selectText()

  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    isEditable: true,
    editFlags: { canCut: false }
  }))
  const cut = contextMenu.items.find(item => item.label === 'Cut')

  expect(cut.enabled).toBe(false)
  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: cut.actionId })
  await expect(searchInput).toHaveValue('selection')
})

test.describe('German locale', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('translates custom context menu actions', async ({ page }) => {
    const searchInput = page.locator('.searchInput input')
    await searchInput.fill('Auswahl')
    await searchInput.selectText()
    await searchInput.click({ button: 'right' })

    const menu = page.getByRole('menu', { name: 'Kontextmenü' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Einfügen' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Alles auswählen' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Ausschneiden' }).click()
    await expect(searchInput).toHaveValue('')
  })
})
