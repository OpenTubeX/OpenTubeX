import assert from 'node:assert/strict'
import test from 'node:test'
import { YT } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { normalizeLocalSubscriptionFeed, parseLocalCommunityPosts } = createLocalFeedParsers(() => false)

const SHARER_ID = 'UCMDQxm7cUx3yXkfeHa5zJIQ'
const ORIGINAL_AUTHOR_ID = 'UCMvBjCzggK1Xd5TNBxVqZwA'

const text = value => ({ runs: [{ text: value }] })
const channelEndpoint = (id, handle) => ({
  commandMetadata: { webCommandMetadata: { url: `/@${handle}`, webPageType: 'WEB_PAGE_TYPE_CHANNEL', apiUrl: '/youtubei/v1/browse' } },
  browseEndpoint: { browseId: id, canonicalBaseUrl: `/@${handle}` }
})
const avatar = name => ({ thumbnails: [{ url: `//yt3.googleusercontent.com/${name}=s76`, width: 76, height: 76 }] })

function backstagePost (postId, content, extra = {}) {
  return {
    backstagePostRenderer: {
      postId,
      authorText: { runs: [{ text: 'YouTube TV', navigationEndpoint: channelEndpoint(ORIGINAL_AUTHOR_ID, 'youtubetv') }] },
      authorThumbnail: avatar('original'),
      authorEndpoint: channelEndpoint(ORIGINAL_AUTHOR_ID, 'youtubetv'),
      contentText: text(content),
      publishedTimeText: text('1 month ago'),
      voteCount: { simpleText: '511' },
      actionButtons: { commentActionButtonsRenderer: { replyButton: { buttonRenderer: { text: { simpleText: '60' } } } } },
      ...extra
    }
  }
}

// Trimmed from a signed-out @TeamYouTube posts tab response
function sharedPost (postId, content, originalPost) {
  return {
    sharedPostRenderer: {
      postId,
      displayName: { runs: [{ text: 'YouTube Viewers', navigationEndpoint: channelEndpoint(SHARER_ID, 'YouTubeViewers') }] },
      thumbnail: avatar('sharer'),
      endpoint: channelEndpoint(SHARER_ID, 'YouTubeViewers'),
      content: text(content),
      publishedTimeText: text('shared 2 days ago'),
      navigationEndpoint: { browseEndpoint: { browseId: 'FEpost_detail', canonicalBaseUrl: `/post/${postId}` } },
      ...(originalPost && { originalPost })
    }
  }
}

function postsTab (posts) {
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            selected: true,
            title: 'Posts',
            endpoint: { commandMetadata: { webCommandMetadata: { url: '/@YouTubeViewers/posts' } }, browseEndpoint: { browseId: SHARER_ID } },
            content: {
              sectionListRenderer: {
                contents: [{
                  itemSectionRenderer: {
                    contents: posts.map(post => ({ backstagePostThreadRenderer: { post } }))
                  }
                }]
              }
            }
          }
        }]
      }
    },
    header: {
      c4TabbedHeaderRenderer: { channelId: SHARER_ID, title: 'YouTube Viewers', avatar: avatar('sharer'), navigationEndpoint: channelEndpoint(SHARER_ID, 'YouTubeViewers') }
    },
    metadata: { channelMetadataRenderer: { title: 'YouTube Viewers', externalId: SHARER_ID, avatar: avatar('sharer') } }
  }
}

const image = {
  backstageImageRenderer: { image: { thumbnails: [{ url: 'https://yt3.ggpht.com/image=s640', width: 640, height: 360 }] } }
}

test('parses shared posts in page order with their original post nested instead of listed separately', () => {
  const data = postsTab([
    backstagePost('regular-1', 'A regular post'),
    sharedPost('shared-1', 'Check this out', backstagePost('original-1', 'NFL Sunday Ticket is back', { backstageAttachment: image })),
    backstagePost('regular-2', 'Another regular post')
  ])
  const channel = new YT.Channel(null, { data })
  const posts = parseLocalCommunityPosts(channel)

  assert.deepEqual(posts.map(post => post.postId), ['regular-1', 'shared-1', 'regular-2'])

  const shared = posts[1]
  assert.equal(shared.postText, 'Check this out')
  assert.equal(shared.author, 'YouTube Viewers')
  assert.equal(shared.authorId, SHARER_ID)
  assert.equal(shared.authorThumbnails[0].url, 'https://yt3.googleusercontent.com/sharer=s76')
  assert.ok(Math.abs(shared.publishedTime - (Date.now() - 2 * 86400000)) < 60000)
  assert.equal(shared.voteCount, null)
  assert.equal(shared.commentCount, null)
  assert.equal(shared.postContent.type, 'sharedPost')

  const original = shared.postContent.content
  assert.equal(original.postId, 'original-1')
  assert.equal(original.postText, 'NFL Sunday Ticket is back')
  assert.equal(original.author, 'YouTube TV')
  assert.equal(original.authorId, ORIGINAL_AUTHOR_ID)
  assert.equal(original.authorThumbnails[0].url, 'https://yt3.googleusercontent.com/original=s76')
  assert.equal(original.voteCount, 511)
  assert.equal(original.commentCount, 60)
  assert.equal(original.postContent.type, 'image')
  assert.equal(original.postContent.content[0].url, 'https://yt3.ggpht.com/image=s640')
})

test('keeps shared posts whose original post was deleted', () => {
  const channel = new YT.Channel(null, { data: postsTab([sharedPost('shared-1', '')]) })
  const [shared] = parseLocalCommunityPosts(channel)

  assert.equal(shared.postId, 'shared-1')
  assert.equal(shared.postText, '')
  assert.deepEqual(shared.postContent, { type: 'sharedPost', content: null })
})

test('background refreshes shift the original post date by the time since the fetch', () => {
  const data = postsTab([sharedPost('shared-1', 'Shared', backstagePost('original-1', 'Original'))])
  const timestamp = Date.now() - 3600000
  const [shared] = normalizeLocalSubscriptionFeed('posts', { data }, SHARER_ID, timestamp)

  assert.ok(Math.abs(shared.publishedTime - (Date.now() - 2 * 86400000 - 3600000)) < 60000)
  assert.ok(Math.abs(shared.postContent.content.publishedTime - (Date.now() - 30 * 86400000 - 3600000)) < 60000)
})
