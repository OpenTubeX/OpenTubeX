import { test, expect, sel } from '../../helpers/app.mjs'

const CACHED_CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const UNKNOWN_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'

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

test('shows fallback metadata for unavailable channels', async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: { error: 'This channel is unavailable' }
  }))

  await openChannelTab(page, CACHED_CHANNEL_ID)

  const cachedChannel = page.locator('.channelDetails:visible')
  await expect(cachedChannel.locator('.name')).toHaveText('Deleted Channel')
  await expect(cachedChannel.locator('img.thumbnail')).toHaveCount(0)
  const fallbackAvatar = cachedChannel.locator('.thumbnail:not(img)')
  await expect(fallbackAvatar).toBeVisible()
  await expect(fallbackAvatar).toHaveCSS('font-size', '100px')

  await openChannelTab(page, UNKNOWN_CHANNEL_ID)

  const unknownChannel = page.locator('.channelDetails:visible')
  await expect(unknownChannel.locator('.name')).toHaveText('Channel name unavailable')
  await expect(page.locator(sel.activeTab)).toContainText('Channel name unavailable')
})
