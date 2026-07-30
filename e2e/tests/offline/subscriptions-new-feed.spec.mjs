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
const newShort = video('new-short-1', 'New short', now - 30 * 60000, {
  isNewInSubscriptionFeed: true,
  thumbnailUrl: 'https://i.ytimg.com/vi/new-short-1/hq720_2.jpg?sqp=selected&rs=signature'
})
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

  test('groups new content by feed category', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Shorts', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(1)
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await expect(page.getByText('New live stream', { exact: true })).toBeVisible()
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()
    await expect(page.getByText('Watched new video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Previously seen video', { exact: true })).toHaveCount(0)

    await expect(page.locator('.ft-list-video').filter({ hasText: 'New video' })).toHaveClass(/grid/)
    await expect(page.locator('.ft-list-video').filter({ hasText: 'New short' })).toHaveClass(/youtubeShort/)
    await expect(page.locator('.ft-list-video').filter({ hasText: 'New live stream' })).not.toHaveClass(/youtubeShort/)
    await expect(page.locator('.ft-list-post').filter({ hasText: 'New community post' })).toHaveClass(/list/)
    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(page.locator('.headerRefreshWidget .lastRefreshTimestamp')).toHaveCount(0)
  })

  test('shows Shorts as portrait cards with their duration and upload time', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    const short = page.locator('.ft-list-video.youtubeShort').filter({ hasText: 'New short' })
    await expect(short).toBeVisible()
    await expect(short.locator('.videoDuration')).toHaveText('2:00')
    await expect(short.locator('.uploadedTime')).not.toBeEmpty()
    await expect(short.locator('.thumbnailImage')).toHaveAttribute('src', newShort.thumbnailUrl)

    const aspectRatio = await short.locator('.thumbnailImage').evaluate(element => {
      return getComputedStyle(element).aspectRatio
    })
    expect(aspectRatio).toBe('2 / 3')

    // This suite seeds the largest thumbnail preference. The portrait grid
    // must honor it instead of falling back to its old fixed card width.
    const cardWidth = await short.evaluate(element => element.getBoundingClientRect().width)
    expect(cardWidth).toBeGreaterThanOrEqual(342)
  })

  test('keeps a new video and its menus open until the video is chosen', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const video = page.locator('.ft-list-video').filter({ hasText: 'New video' })
    await video.locator('.thumbnailLink').click({ button: 'right' })

    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible()
    await expect(video).toBeVisible()
    // The broken behavior removed the card after its 200 ms leave transition.
    await page.waitForTimeout(300)
    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible()
    await expect(video).toBeVisible()

    await page.keyboard.press('Escape')
    await video.hover()
    await video.locator('.optionsButton').click()

    await expect(video.locator('.optionsButton .iconDropdown')).toBeVisible()
    await expect(video).toBeVisible()
  })
})

test.describe('new feed settings and seen state', () => {
  const videoPost = {
    ...post('new-post-2', 'New video post', now - 40 * 60000),
    postContent: {
      type: 'video',
      content: video('post-video-1', 'Attached video', now - 40 * 60000)
    }
  }
  const cacheWithVideoPost = [{
    ...populatedCache[0],
    communityPosts: [...populatedCache[0].communityPosts, videoPost]
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        listType: 'list',
        showNewSubscriptionFeedIndicators: false
      },
      profiles: [profile()],
      subscriptionCache: cacheWithVideoPost
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
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__markSeenMutations = []
      window.__unsubscribeMarkSeen = store.subscribe((mutation) => {
        if (mutation.type === 'markSubscriptionEntriesAsSeenInCache') {
          window.__markSeenMutations.push(mutation.payload)
        }
      })
    })
    await markAllAsSeen.click()
    await expect(page.getByText('There is no new content.')).toBeVisible()
    expect(await page.evaluate(() => {
      window.__unsubscribeMarkSeen()
      return window.__markSeenMutations
    })).toEqual([[
      { tab: 'videos', channelId: CHANNEL_ID },
      { tab: 'shorts', channelId: CHANNEL_ID },
      { tab: 'live', channelId: CHANNEL_ID },
      { tab: 'posts', channelId: CHANNEL_ID }
    ]])
    await expect(markAllAsSeen).toHaveCount(0)

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('There is no new content.')).toBeVisible()
  })

  test('keeps YouTube-style Shorts as portrait grid cards in list display mode', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    const short = page.locator('.ft-list-video.youtubeShort').filter({ hasText: 'New short' })
    await expect(short).toBeVisible()
    // The list layout squeezes the portrait card into a row and drops the
    // portrait thumbnail rule, which the grid class must prevent.
    await expect(short).toContainClass('grid')
    await expect(short).not.toContainClass('list')

    const aspectRatio = await short.locator('.thumbnailImage').evaluate(element => {
      return getComputedStyle(element).aspectRatio
    })
    expect(aspectRatio).toBe('2 / 3')
  })

  test('stacks community post sections in list display mode', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const post = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(post).toBeVisible()

    // The video list template placed the author, the text and the bottom
    // section into its three columns instead of stacking them.
    const layout = await post.evaluate(element => {
      const author = element.querySelector('.author-div').getBoundingClientRect()
      const text = element.querySelector('.postText').getBoundingClientRect()

      return {
        postWidth: element.getBoundingClientRect().width,
        authorBottom: author.bottom,
        textTop: text.top,
        textWidth: text.width
      }
    })

    expect(layout.textTop).toBeGreaterThanOrEqual(layout.authorBottom)
    expect(layout.textWidth).toBeGreaterThan(layout.postWidth * 0.8)
  })

  test('keeps an attached video inside a post as a full width card in list display mode', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const attachedVideo = page.locator('.ft-list-post .ft-list-video').filter({ hasText: 'Attached video' })
    await expect(attachedVideo).toBeVisible()
    // The list layout put the thumbnail beside the title and left the duration
    // badge stranded outside the shrunken thumbnail.
    await expect(attachedVideo).toContainClass('grid')

    const layout = await attachedVideo.evaluate(element => {
      const thumbnail = element.querySelector('.videoThumbnail').getBoundingClientRect()
      const title = element.querySelector('.title').getBoundingClientRect()
      const duration = element.querySelector('.videoDuration').getBoundingClientRect()

      return {
        cardWidth: element.getBoundingClientRect().width,
        thumbnailWidth: thumbnail.width,
        thumbnailRight: thumbnail.right,
        titleTop: title.top,
        thumbnailBottom: thumbnail.bottom,
        durationRight: duration.right
      }
    })

    expect(layout.thumbnailWidth).toBeGreaterThan(layout.cardWidth * 0.8)
    expect(layout.titleTop).toBeGreaterThanOrEqual(layout.thumbnailBottom - 12)
    expect(layout.durationRight).toBeLessThanOrEqual(layout.thumbnailRight)
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

test.describe('classic Shorts watch layout', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        useCustomShortsPlayer: false
      },
      profiles: [profile()],
      subscriptionCache: populatedCache
    }
  })

  test('uses the regular player thumbnail morph when YouTube-style Shorts are disabled', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.getByText('New short', { exact: true })).toBeVisible()

    await page.evaluate(() => {
      window.__watchMorphClasses = []
      const observer = new MutationObserver(() => {
        window.__watchMorphClasses.push(document.documentElement.className)
      })
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    })

    await page.getByText('New short', { exact: true }).click()
    await expect(page).toHaveURL(/#\/watch\/new-short-1\?short=true&shortSource=subscriptions/)
    await page.waitForTimeout(350)

    const morphClasses = await page.evaluate(() => window.__watchMorphClasses)
    expect(morphClasses.some(value => value.includes('viewTransitionMorphActive'))).toBe(true)
    expect(morphClasses.some(value => value.includes('viewTransitionShortMorphActive'))).toBe(false)
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

test.describe('new feed latest-per-channel limit', () => {
  const publishedTimeShort = video('published-time-short', 'New short by published time', undefined, {
    isNewInSubscriptionFeed: true,
    publishedTime: now + HOUR
  })
  const latestLimitCache = [{
    ...populatedCache[0],
    shorts: [publishedTimeShort]
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        onlyShowLatestFromChannel: true,
        onlyShowLatestFromChannelNumber: 1
      },
      profiles: [profile()],
      subscriptionCache: latestLimitCache
    }
  })

  test('applies the limit across media categories', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('New short by published time', { exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Live', exact: true })).toHaveCount(0)
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
    expect(await page.locator('.promptCard').evaluate(
      element => element.scrollHeight <= element.clientHeight
    )).toBe(true)

    await page.getByRole('button', { name: 'No', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toHaveCount(0)
    await expect(page.getByText('There is no new content.')).toBeVisible()
  })
})
