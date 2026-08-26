import { expect, goTo } from '../helpers/app.mjs'

const now = Date.now()
const channelCount = 933
const videosPerChannel = 36
const switchTimeoutMs = 15_000

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

export const largeSubscriptionsSeed = {
  settings: {
    fetchSubscriptionsAutomatically: false,
    hideSubscriptionsVideos: false,
    hideSubscriptionsShorts: true,
    hideSubscriptionsLive: true,
    hideSubscriptionsCommunity: true,
    showNewSubscriptionFeed: true,
    generalAutoLoadMorePaginatedItemsEnabled: false,
    reducedMotion: 'off',
    uiScale: 95
  },
  profiles,
  subscriptionCache
}

async function measureVideosSwitch(page) {
  let timeout
  try {
    return await Promise.race([
      page.evaluate(() => new Promise(resolve => {
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
      })),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(
          `Subscription tab switch did not render within ${switchTimeoutMs} ms`
        )), switchTimeoutMs)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

export async function runLargeSubscriptionsBenchmark(page) {
  await goTo(page, 'trending')
  await page.evaluate(() => localStorage.setItem('Subscriptions/currentTab', 'new'))
  await goTo(page, 'subscriptions')

  await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
  const firstSwitch = await measureVideosSwitch(page)
  await expect(page.getByText('Video 0-0')).toBeVisible()

  await page.locator('[data-subscription-feed-tab="all"]').click()
  await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
  const repeatedSwitch = await measureVideosSwitch(page)
  await expect(page.getByText('Video 0-0')).toBeVisible()

  return {
    firstSwitchElapsedMs: firstSwitch.elapsed,
    firstSwitchLongestFrameMs: firstSwitch.longestFrame,
    repeatedSwitchElapsedMs: repeatedSwitch.elapsed,
    repeatedSwitchLongestFrameMs: repeatedSwitch.longestFrame
  }
}
