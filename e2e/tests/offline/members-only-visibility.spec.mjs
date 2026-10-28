import { test, expect, goTo, sel } from '../../helpers/app.mjs'

const MEMBER_CHANNEL = 'UCmmmmmmmmmmmmmmmmmmmmmm'
const OTHER_CHANNEL = 'UCoooooooooooooooooooooo'

test.use({
  seed: {
    settings: {
      generalAutoLoadMorePaginatedItemsEnabled: false,
      ytDlpPlaybackAuthMode: 'browser',
      ytDlpPlaybackCookiesBrowser: 'firefox'
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: MEMBER_CHANNEL, name: 'Member channel', thumbnail: '' }]
    }]
  }
})

test('hides members-only results unless the subscription shows them, even with playback cookies', async ({ page }) => {
  await page.evaluate(({ memberChannel, otherChannel }) => {
    const result = (videoId, title, authorId, isMembersOnly) => ({
      type: 'video', videoId, title, author: title, authorId, isMembersOnly, lengthSeconds: 60, viewCount: 1, videoThumbnails: []
    })
    window.$store.commit('addToSessionSearchHistory', {
      query: 'members only',
      data: [
        result('publicvideo', 'Public video', otherChannel, false),
        result('membervideo', 'Subscribed members video', memberChannel, true),
        result('othervideo', 'Unsubscribed members video', otherChannel, true)
      ],
      searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
  }, { memberChannel: MEMBER_CHANNEL, otherChannel: OTHER_CHANNEL })

  await page.locator(sel.searchInput).fill('members only')
  await page.locator(sel.searchInput).press('Enter')

  const subscribedVideo = page.locator('.ft-list-video').filter({ hasText: 'Subscribed members video' })
  await expect(page.locator('.ft-list-video').filter({ hasText: 'Public video' })).toBeVisible()
  await expect(subscribedVideo).toHaveCount(0)
  await expect(page.getByText('Unsubscribed members video')).toHaveCount(0)

  await page.evaluate(channelId => window.$store.dispatch('updateChannelSettings', {
    channelId, settings: { showMembersOnly: true }
  }), MEMBER_CHANNEL)
  await expect(subscribedVideo.locator('.membersOnlyTag')).toBeVisible()
  await expect(page.getByText('Unsubscribed members video')).toHaveCount(0)

  await page.evaluate(() => window.$store.dispatch('updateYtDlpPlaybackAuthMode', 'none'))
  await expect(subscribedVideo).toHaveCount(0)
})

test.describe('community post attachments', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        hideSubscriptionsCommunity: false,
        useRssFeeds: false,
        ytDlpPlaybackAuthMode: 'browser',
        ytDlpPlaybackCookiesBrowser: 'firefox'
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: MEMBER_CHANNEL, name: 'Member channel', thumbnail: '' }]
      }],
      subscriptionCache: [{
        _id: MEMBER_CHANNEL,
        communityPosts: [{
          postId: 'members-post',
          postText: 'Watch the members video',
          author: 'Member channel',
          authorId: MEMBER_CHANNEL,
          authorThumbnails: [],
          publishedTime: Date.now() - 60000,
          voteCount: null,
          commentCount: null,
          postContent: {
            type: 'video',
            content: {
              type: 'video',
              videoId: 'attachedvid',
              title: 'Attached members video',
              author: 'Member channel',
              authorId: MEMBER_CHANNEL,
              isMembersOnly: true,
              lengthSeconds: 60,
              viewCount: 1
            }
          },
          type: 'community'
        }],
        communityPostsTimestamp: new Date(Date.now() - 60000).toISOString()
      }]
    }
  })

  test('hides an attached members-only video unless the subscription shows it', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const post = page.locator('.ft-list-post').filter({ hasText: 'Watch the members video' })
    await expect(post.locator('.hiddenVideo')).toBeVisible()
    await expect(post.getByText('Attached members video')).toHaveCount(0)

    await page.evaluate(channelId => window.$store.dispatch('updateChannelSettings', {
      channelId, settings: { showMembersOnly: true }
    }), MEMBER_CHANNEL)
    await expect(post.getByText('Attached members video')).toBeVisible()
  })
})
