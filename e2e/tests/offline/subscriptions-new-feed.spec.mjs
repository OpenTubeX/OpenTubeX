import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const HOUR = 3600000
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

function video (videoId, title, published, extra = {}) {
  return {
    videoId,
    title,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    published,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    ...extra
  }
}

function post (postId, text, publishedTime) {
  return {
    postId,
    postText: text,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    authorThumbnails: [],
    publishedTime,
    voteCount: 1,
    commentCount: 0,
    postContent: { type: 'text', content: '' },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

function profile (subscriptions = [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]) {
  return {
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions
  }
}

const newVideo = video('new-video-1', 'New video', now - HOUR, { isNewInSubscriptionFeed: true })
const watchedVideo = video('watched-new', 'Watched new video', now - 2 * HOUR, { isNewInSubscriptionFeed: true })
const oldVideo = video('not-new', 'Previously seen video', now - 3 * HOUR, { isNewInSubscriptionFeed: false })
const newShort = video('new-short-1', 'New short', now - 30 * 60000, { isNewInSubscriptionFeed: true })
const newLive = video('new-live-1', 'New live stream', now - 15 * 60000, {
  isNewInSubscriptionFeed: true,
  liveNow: true
})

const populatedCache = [{
  _id: CHANNEL_ID,
  videos: [newVideo, watchedVideo, oldVideo],
  videosTimestamp: new Date(now - HOUR).toISOString(),
  shorts: [newShort],
  shortsTimestamp: new Date(now - HOUR).toISOString(),
  liveStreams: [newVideo, newLive],
  liveStreamsTimestamp: new Date(now - HOUR).toISOString(),
  communityPosts: [post('new-post-1', 'New community post', now - 45 * 60000)],
  communityPostsTimestamp: new Date(now - HOUR).toISOString()
}]

const watchedHistory = [{
  _id: watchedVideo.videoId,
  ...watchedVideo,
  description: '',
  watchProgress: watchedVideo.lengthSeconds,
  timeWatched: now,
  isWatched: true,
  isLive: false
}]

const commonSettings = {
  fetchSubscriptionsAutomatically: false,
  hideSubscriptionsVideos: false,
  hideSubscriptionsShorts: false,
  hideSubscriptionsLive: false,
  hideSubscriptionsCommunity: false,
  showNewSubscriptionFeed: true,
  useRssFeeds: false
}

test.describe('new subscriptions feed', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        listType: 'grid',
        showNewSubscriptionFeedIndicators: true,
        thumbnailSize: 180
      },
      profiles: [profile()],
      history: watchedHistory,
      subscriptionCache: populatedCache
    }
  })

  test('combines new content without mixing posts into the media grid', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(1)
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await expect(page.getByText('New live stream', { exact: true })).toBeVisible()
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()
    await expect(page.getByText('Watched new video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Previously seen video', { exact: true })).toHaveCount(0)

    await expect(page.locator('.ft-list-video').filter({ hasText: 'New video' })).toHaveClass(/grid/)
    await expect(page.locator('.ft-list-post').filter({ hasText: 'New community post' })).toHaveClass(/list/)
    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(page.locator('.headerRefreshWidget .lastRefreshTimestamp')).toHaveCount(0)
  })
})

test.describe('new feed settings and seen state', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        listType: 'list',
        showNewSubscriptionFeedIndicators: false
      },
      profiles: [profile()],
      subscriptionCache: populatedCache
    }
  })

  test('works without dots and persists marking all entries as seen', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.locator('[data-subscription-feed-tab="all"]')).toBeVisible()
    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="all"]').click()
    const newVideoCard = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await expect(newVideoCard).toHaveClass(/list/)

    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(markAllAsSeen).toBeVisible()
    await markAllAsSeen.click()
    await expect(page.getByText('There is no new content.')).toBeVisible()
    await expect(markAllAsSeen).toHaveCount(0)

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('There is no new content.')).toBeVisible()
  })

  test('persists a post as seen when its comments are opened', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const newPost = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(newPost).toBeVisible()
    await newPost.locator('.commentsLink').click()
    await expect(page).toHaveURL(/#\/post\/new-post-1/)

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('New community post', { exact: true })).toHaveCount(0)
  })
})

test.describe('new feed display filters', () => {
  const hiddenPremiere = video('hidden-premiere', 'Hidden premiere', now + HOUR, {
    isNewInSubscriptionFeed: true,
    isUpcoming: true,
    premiereDate: new Date(now + HOUR).toISOString()
  })
  const forbiddenVideo = video('forbidden-video', 'Blocked title', now - HOUR, {
    isNewInSubscriptionFeed: true
  })
  const hiddenLive = video('hidden-live', 'Hidden live stream', now, {
    isNewInSubscriptionFeed: true,
    liveNow: true
  })
  const forbiddenPost = {
    ...post('forbidden-post', 'Forbidden post', now),
    author: 'Blocked channel'
  }
  const hiddenCache = [{
    _id: CHANNEL_ID,
    videos: [hiddenPremiere, forbiddenVideo],
    videosTimestamp: new Date(now).toISOString(),
    shorts: [],
    shortsTimestamp: new Date(now).toISOString(),
    liveStreams: [hiddenLive],
    liveStreamsTimestamp: new Date(now).toISOString(),
    communityPosts: [forbiddenPost],
    communityPostsTimestamp: new Date(now).toISOString()
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        forbiddenTitles: JSON.stringify(['Blocked']),
        hideLiveStreams: true,
        hideUpcomingPremieres: true,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profile()],
      subscriptionCache: hiddenCache
    }
  })

  test('does not advertise new content hidden by display preferences', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
    await page.locator('[data-subscription-feed-tab="posts"]').click()
    await expect(page.getByText(/Posts feed last updated:/)).toBeVisible()
    await expect(page.getByText('Forbidden post', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('There is no new content.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
  })
})

test.describe('independent new feed setting', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeed: false,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profile()],
      history: watchedHistory,
      subscriptionCache: populatedCache
    }
  })

  test('can hide the New tab without disabling indicators', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await expect(page.locator('[data-subscription-feed-tab="all"]')).toHaveCount(0)
    await expect(page.locator('.newContentDot')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeVisible()
  })
})

test.describe('large new feed refresh', () => {
  const subscriptions = Array.from({ length: 126 }, (_, index) => ({
    id: `UC${String(index).padStart(22, '0')}`,
    name: `Channel ${index}`,
    thumbnail: ''
  }))

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeedIndicators: false
      },
      profiles: [profile(subscriptions)]
    }
  })

  test('warns before refreshing all non-RSS feeds', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('There is no new content.')).toBeVisible()

    const refreshNewContent = page.getByRole('button', { name: /Refresh New content/ })
    await expect(refreshNewContent).toBeVisible()
    await refreshNewContent.click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toBeVisible()
    await expect(page.getByText(/126 subscriptions can take a long time/)).toBeVisible()

    await page.getByRole('button', { name: 'No', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toHaveCount(0)
    await expect(page.getByText('There is no new content.')).toBeVisible()
  })
})
