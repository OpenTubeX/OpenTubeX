import { test, expect } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test'
    }
  }
})

test('opening a channel requests only its first tab and each other tab on its first visit', async ({ page }) => {
  const requests = []
  await page.route('https://invidious.test/api/v1/channels/**', route => {
    const tab = new URL(route.request().url()).pathname.split('/')[5] ?? 'channel'
    requests.push(tab)
    return route.fulfill({
      json: tab === 'channel'
        ? {
            author: 'Channel',
            authorId: CHANNEL_ID,
            authorThumbnails: [],
            authorBanners: [],
            description: '',
            subCount: 0,
            totalViews: 0,
            joined: 0,
            tabs: ['videos', 'shorts', 'streams', 'playlists', 'posts', 'about'],
            relatedChannels: []
          }
        : { videos: [], playlists: [], comments: [], continuation: null }
    })
  })

  const tab = await page.evaluate(id => window.ftElectron.tabs.create({
    route: `/channel/${id}`,
    makeActive: false
  }), CHANNEL_ID)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()

  const channel = page.locator('.channelDetails:visible')
  const message = page.locator('.channelContent:visible .message')
  await expect(channel.locator('#playlistsTab')).toBeVisible()
  await expect(message).toBeVisible()
  expect(requests).toEqual(['channel', 'videos'])

  await channel.locator('#playlistsTab').click()
  await expect(channel.locator('#playlistsTab')).toHaveAttribute('aria-selected', 'true')
  await expect(message).toBeVisible()
  await channel.locator('#videosTab').click()
  await channel.locator('#playlistsTab').click()
  await expect(message).toBeVisible()
  expect(requests).toEqual(['channel', 'videos', 'playlists'])
})
