import { test, expect } from '../../helpers/app.mjs'

const CACHED_CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: 'https://invidious.test'
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{
        id: CACHED_CHANNEL_ID,
        name: 'Deleted Channel',
        thumbnail: 'data:image/png;base64,invalid'
      }]
    }]
  }
})

async function openChannelTab(page, channelId) {
  const tab = await page.evaluate((id) => window.ftElectron.tabs.create({
    route: `/channel/${id}`,
    makeActive: false
  }), channelId)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
}

test('keeps subscription options inside the channel page viewport without horizontal overflow', async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: { error: 'This channel is unavailable' }
  }))
  await openChannelTab(page, CACHED_CHANNEL_ID)

  const channel = page.locator('.channelDetails:visible')
  await channel.locator('.buttonList').evaluate(element => {
    element.dataset.subscriptionOptionsTrigger = ''
  })
  const scrollWidthBefore = await page.evaluate(() => document.documentElement.scrollWidth)
  await channel.getByRole('button', { name: 'Subscription settings' }).click()

  const dropdown = page.locator('body > .profileDropdown')
  await expect(dropdown).toBeVisible()
  await expect(dropdown).not.toHaveClass(/profile-dropdown-enter-active/)
  expect(await dropdown.evaluate((element, { initialScrollWidth, triggerSelector }) => {
    const rect = element.getBoundingClientRect()
    const triggerRect = document.querySelector(triggerSelector).getBoundingClientRect()
    return {
      anchoredInlineEnd: Math.abs(rect.right - triggerRect.right) <= 1,
      anchoredVertically: Math.abs(rect.top - triggerRect.bottom - 4) <= 1,
      leftFits: rect.left >= 7.5,
      rightFits: rect.right <= window.innerWidth - 7.5,
      scrollWidthUnchanged: document.documentElement.scrollWidth === initialScrollWidth
    }
  }, {
    initialScrollWidth: scrollWidthBefore,
    triggerSelector: '[data-subscription-options-trigger]'
  })).toEqual({
    anchoredInlineEnd: true,
    anchoredVertically: true,
    leftFits: true,
    rightFits: true,
    scrollWidthUnchanged: true
  })

  await channel.locator('.buttonList').evaluate(element => {
    element.style.transform = 'translateX(-80px)'
  })
  await expect.poll(() => dropdown.evaluate((element, triggerSelector) => {
    const rect = element.getBoundingClientRect()
    const triggerRect = document.querySelector(triggerSelector).getBoundingClientRect()
    return Math.abs(rect.right - triggerRect.right)
  }, '[data-subscription-options-trigger]')).toBeLessThanOrEqual(1)
})
