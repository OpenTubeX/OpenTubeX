import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const channelCount = 933
const videosPerChannel = 36

const profiles = [{
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#000000',
  textColor: '#FFFFFF',
  subscriptions: Array.from({ length: channelCount }, (_, channelIndex) => ({
    id: `UC${String(channelIndex).padStart(22, '0')}`,
    name: `Channel ${channelIndex}`,
    thumbnail: ''
  }))
}]

const subscriptionCache = profiles[0].subscriptions.map((channel, channelIndex) => ({
  _id: channel.id,
  videos: Array.from({ length: videosPerChannel }, (_, videoIndex) => ({
    videoId: `video-${channelIndex}-${videoIndex}`,
    title: `Video ${channelIndex}-${videoIndex}`,
    author: channel.name,
    authorId: channel.id,
    published: now - (videoIndex * channelCount + channelIndex) * 3600000,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    isNewInSubscriptionFeed: true,
    type: 'video'
  })),
  videosTimestamp: new Date(now).toISOString(),
  shorts: [],
  shortsTimestamp: new Date(now).toISOString()
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: true,
      hideSubscriptionsLive: true,
      hideSubscriptionsCommunity: true,
      showNewSubscriptionFeed: true,
      reducedMotion: 'off',
      uiScale: 95
    },
    profiles,
    subscriptionCache
  }
})

async function measureVideosSwitch(page) {
  return page.evaluate(() => new Promise(resolve => {
    const target = document.querySelector('[data-subscription-feed-tab="videos"]')
    const startedAt = performance.now()
    let previousFrame = startedAt
    let longestFrame = 0

    function sampleFrame(timestamp) {
      longestFrame = Math.max(longestFrame, timestamp - previousFrame)
      previousFrame = timestamp

      const panel = document.querySelector('#subscriptionsPanel:not(.newFeed)')
      const feedIsRendered = target.getAttribute('aria-selected') === 'true' &&
        panel?.querySelector('.ft-list-video') !== null

      if (feedIsRendered) {
        requestAnimationFrame(finishedAt => resolve({
          elapsed: finishedAt - startedAt,
          longestFrame
        }))
        return
      }

      requestAnimationFrame(sampleFrame)
    }

    target.click()
    requestAnimationFrame(sampleFrame)
  }))
}

test('switches a production-profile-sized cached feed without repeating expensive work', async ({ page }) => {
  await goTo(page, 'trending')
  await page.evaluate(() => localStorage.setItem('Subscriptions/currentTab', 'new'))
  await goTo(page, 'subscriptions')

  await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()

  const firstSwitch = await measureVideosSwitch(page)

  expect(firstSwitch.longestFrame).toBeLessThan(200)
  expect(firstSwitch.elapsed).toBeLessThan(250)
  await expect(page.getByText('Video 0-0')).toBeVisible()

  await page.locator('[data-subscription-feed-tab="all"]').click()
  await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()

  const repeatedSwitch = await measureVideosSwitch(page)

  expect(repeatedSwitch.longestFrame).toBeLessThan(100)
  expect(repeatedSwitch.elapsed).toBeLessThan(150)
  await expect(page.getByText('Video 0-0')).toBeVisible()
})
