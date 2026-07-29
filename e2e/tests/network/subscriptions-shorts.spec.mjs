import { goTo } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

const CHANNEL_ID = 'UCmlzNHg8QiWVutUyFOV2UdQ'

test.use({
  seed: {
    settings: {
      backendPreference: 'local',
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: true,
      hideSubscriptionsLive: true,
      hideSubscriptionsCommunity: true,
      useCustomShortsPlayer: true
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{
        id: CHANNEL_ID,
        name: 'The Stock Pot',
        thumbnail: ''
      }]
    }]
  }
})

test('subscription refresh uses YouTube selected Shorts thumbnails', async ({ page, innertube }) => {
  test.skip(innertube.replay, 'subscription refresh needs the real API')

  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="shorts"]').click()
  await page.getByRole('button', { name: /Refresh Shorts/ }).click()

  const short = page.locator('.ft-list-video.youtubeShort').first()
  await expect(short).toBeVisible({ timeout: 60_000 })
  const thumbnailUrl = await short.locator('.thumbnailImage').getAttribute('src')

  expect(thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//)
  expect(thumbnailUrl).not.toMatch(/oardefault\.jpg|thumbnail_placeholder/)
})
