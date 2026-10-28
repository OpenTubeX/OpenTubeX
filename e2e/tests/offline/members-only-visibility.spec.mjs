import { readFile } from 'node:fs/promises'
import { test, expect, goTo, sel } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

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

async function routePlaylist(page, lockups) {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.route('https://www.youtube.com/youtubei/v1/browse**', route => route.fulfill({
    json: {
      metadata: { playlistMetadataRenderer: { title: 'Mixed playlist', description: '' } },
      sidebar: {
        playlistSidebarRenderer: {
          items: [{
            playlistSidebarPrimaryInfoRenderer: {
              title: { simpleText: 'Mixed playlist' },
              stats: [{ simpleText: '2 videos' }, { simpleText: 'No views' }],
              thumbnailRenderer: {
                playlistVideoThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/sampleVid01/hqdefault.jpg', width: 480, height: 360 }] } }
              }
            }
          }]
        }
      },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [{
                    itemSectionRenderer: {
                      contents: [{
                        playlistVideoListRenderer: {
                          playlistId: 'PL-mixed-playlist',
                          contents: lockups.map(lockup => ({ lockupViewModel: lockup }))
                        }
                      }]
                    }
                  }]
                }
              }
            }
          }]
        }
      }
    }
  }))
}

test.describe('YouTube playlists', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'local',
        backendFallback: false,
        enableSearchSuggestions: false,
        ytDlpPlaybackAuthMode: 'browser',
        ytDlpPlaybackCookiesBrowser: 'firefox'
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: 'UC-sample-channel', name: 'StudioPreview', thumbnail: '' }]
      }]
    }
  })

  test('hides members-only playlist videos unless the subscription shows them', async ({ page }) => {
    const lockup = JSON.parse(await readFile(new URL('../../fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))
    const publicVideo = structuredClone(lockup)
    const membersVideo = structuredClone(lockup)
    membersVideo.contentId = 'memberVid01'
    membersVideo.metadata.lockupMetadataViewModel.title.content = 'Members playlist video'
    membersVideo.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[1].badges = [{
      badgeViewModel: { badgeText: 'Members only', badgeStyle: 'BADGE_MEMBERS_ONLY' }
    }]
    await routePlaylist(page, [publicVideo, membersVideo])
    await page.locator(sel.searchInput).fill('https://www.youtube.com/playlist?list=PL-mixed-playlist')
    await page.locator(sel.searchInput).press('Enter')

    const items = page.locator('.playlistItemsCard')
    await expect(items.getByText('Sample recommendation', { exact: true })).toBeVisible()
    await expect(items.getByText('Members playlist video')).toHaveCount(0)

    await page.evaluate(channelId => window.$store.dispatch('updateChannelSettings', {
      channelId, settings: { showMembersOnly: true }
    }), 'UC-sample-channel')
    await expect(items.getByText('Members playlist video')).toBeVisible()
  })

  test('says a YouTube playlist has no videos when all of them are hidden members-only videos', async ({ page }) => {
    const lockup = JSON.parse(await readFile(new URL('../../fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))
    lockup.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[1].badges = [{
      badgeViewModel: { badgeText: 'Members only', badgeStyle: 'BADGE_MEMBERS_ONLY' }
    }]
    await routePlaylist(page, [lockup])
    await page.locator(sel.searchInput).fill('https://www.youtube.com/playlist?list=PL-mixed-playlist')
    await page.locator(sel.searchInput).press('Enter')

    await expect(page.getByText('This playlist currently has no videos.')).toBeVisible()
    await page.evaluate(channelId => window.$store.dispatch('updateChannelSettings', {
      channelId, settings: { showMembersOnly: true }
    }), 'UC-sample-channel')
    await expect(page.locator('.playlistItemsCard').getByText('Sample recommendation', { exact: true })).toBeVisible()
  })
})
