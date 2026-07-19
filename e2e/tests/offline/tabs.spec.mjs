import { test, expect, sel, goTo } from '../../helpers/app.mjs'

test.describe('tab bar', () => {
  test('new tab button opens a tab and activates it', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)
    await expect(page.locator(sel.tabs).nth(1)).toContainText('Subscriptions')
    await expect(page.locator(sel.tabs).nth(1)).not.toContainText('/subscriptions')
  })

  test('Ctrl+T opens and Ctrl+W closes a tab', async ({ page }) => {
    await page.keyboard.press('Control+t')
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).nth(1)).toContainText('Subscriptions')
    await expect(page.locator(sel.tabs).nth(1)).not.toContainText('/subscriptions')

    await page.keyboard.press('Control+w')
    await expect(page.locator(sel.tabs)).toHaveCount(1)
  })

  test('each tab keeps its own route', async ({ page }) => {
    await goTo(page, 'settings')
    await expect(page).toHaveURL(/#\/settings/)

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history/)

    // Switch back to the first tab: its route must be restored.
    await page.locator(sel.tabs).first().click()
    await expect(page).toHaveURL(/#\/settings/)

    await page.locator(sel.tabs).nth(1).click()
    await expect(page).toHaveURL(/#\/history/)
  })

  // Regression: search bar text used to leak between tabs (65f4e2e13)
  test('search bar text is independent per tab', async ({ page }) => {
    const searchInput = page.locator(sel.searchInput)
    await searchInput.fill('first tab query')

    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(searchInput).toHaveValue('')

    await searchInput.fill('second tab query')

    await page.locator(sel.tabs).first().click()
    await expect(searchInput).toHaveValue('first tab query')

    await page.locator(sel.tabs).nth(1).click()
    await expect(searchInput).toHaveValue('second tab query')
  })

  test('closing the active tab activates a remaining tab', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(3)

    await page.locator(sel.activeTab).locator('.closeButton').click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.activeTab)).toHaveCount(1)
  })

  // Regression: selected tab was lost when navigating back (3f498ec59)
  test('history back keeps the current tab selected', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)

    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history/)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/subscriptions/)
    await expect(page.locator(sel.tabs).nth(1)).toHaveClass(/active/)
  })
})

test.describe('localized tab titles', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('new subscription tabs use the loaded locale', async ({ page }) => {
    await expect(page.locator(sel.activeTab)).toContainText('Abos')

    await page.keyboard.press('Control+t')
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.activeTab)).toContainText('Abos')
    await expect(page.locator(sel.activeTab)).not.toContainText(/\/subscriptions|Subscriptions\.Subscriptions/)
  })
})

test.describe('subscription feed tabs', () => {
  test.use({
    seed: {
      settings: {
        hideSubscriptionsVideos: false,
        hideSubscriptionsShorts: false,
        hideSubscriptionsLive: false,
        hideSubscriptionsCommunity: false,
        useRssFeeds: false
      }
    }
  })

  test('uses the last selected feed for newly opened subscription tabs', async ({ page }) => {
    const feedTab = (tab) => page.locator(`[data-subscription-feed-tab="${tab}"]`)

    await feedTab('shorts').click()
    await expect(feedTab('shorts')).toHaveAttribute('aria-selected', 'true')

    await page.locator(sel.newTabButton).click()
    await expect(feedTab('shorts')).toHaveAttribute('aria-selected', 'true')

    await feedTab('live').click()
    await page.locator(sel.tabs).first().click()
    await expect(feedTab('shorts')).toHaveAttribute('aria-selected', 'true')

    await goTo(page, 'settings')
    await goTo(page, 'subscriptions')
    await expect(feedTab('live')).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('background tab shortcuts', () => {
  test.use({
    seed: {
      settings: { fetchSubscriptionsAutomatically: false },
      profiles: [
        {
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: [
            {
              id: 'UC-test-subscription',
              name: 'Test subscription',
              thumbnail: ''
            }
          ]
        }
      ]
    }
  })

  // Regression: the document-level subscriptions listener refreshed a hidden
  // tab when R was pressed in a different tab (d20ff948f).
  test('R does not refresh subscriptions in a background tab', async ({ page }) => {
    await expect(page.getByText(/disabled automatic subscription fetching/i)).toBeVisible()

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'settings')

    const externalRequests = []
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) {
        externalRequests.push(request.url())
      }
    })

    await page.locator('body').press('r')
    await page.waitForTimeout(500)
    expect(externalRequests).toEqual([])
  })
})
