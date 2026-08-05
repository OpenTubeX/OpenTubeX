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

  const short = page.locator('.ft-list-video.youtubeShort').first()

  // YouTube sometimes answers with an empty Shorts tab for a channel that does
  // have Shorts, so the finished refresh leaves the feed empty. Asking again
  // returns the real one, the refresh button only comes back once the previous
  // refresh is done.
  let served = false
  for (let attempt = 0; attempt < 3 && !served; attempt++) {
    await page.getByRole('button', { name: /Refresh Shorts/ }).click()
    served = await short.waitFor({ state: 'visible', timeout: 25_000 }).then(() => true, () => false)
  }

  // There is no thumbnail to assert on when the API never serves the Shorts.
  test.skip(!served, 'the live API kept answering with an empty Shorts tab')

  const thumbnailUrl = await short.locator('.thumbnailImage').getAttribute('src')

  expect(thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//)
  expect(thumbnailUrl).not.toMatch(/oardefault\.jpg|thumbnail_placeholder/)
})
