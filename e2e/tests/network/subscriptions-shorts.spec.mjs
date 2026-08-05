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

  if (!served) {
    // Only a refresh that finished and reported an empty feed is the API
    // withholding the Shorts. Shorts that never render without that message
    // are a real failure, so they fall through to the assertion below.
    const emptyFeed = page.locator('.message', { hasText: 'does not have any videos' })
    const confirmedEmpty = await emptyFeed.waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true, () => false)
    test.skip(confirmedEmpty, 'the live API kept answering with an empty Shorts tab')
  }

  await expect(short).toBeVisible()
  const thumbnailUrl = await short.locator('.thumbnailImage').getAttribute('src')

  expect(thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//)
  expect(thumbnailUrl).not.toMatch(/oardefault\.jpg|thumbnail_placeholder/)
})
