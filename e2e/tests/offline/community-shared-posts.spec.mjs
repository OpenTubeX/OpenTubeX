import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const SHARER_ID = 'UCGg-UqjRgzhYDPJMr-9HXCg'
const ORIGINAL_AUTHOR_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const avatar = color => [{
  url: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="76" height="76"><rect width="76" height="76" fill="${color}"/></svg>`,
  width: 76,
  height: 76
}]
const image = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="%233a7bd5"/></svg>'

function sharedPost(postId, postText, original, minutesAgo) {
  return {
    postId,
    postText,
    author: 'Creator Insider',
    authorId: SHARER_ID,
    authorThumbnails: avatar('%23c33'),
    publishedTime: now - minutesAgo * 60000,
    voteCount: null,
    commentCount: null,
    postContent: { type: 'sharedPost', content: original },
    type: 'community'
  }
}

const originalPost = {
  postId: 'original-post',
  postText: 'Our letter to creators about what is coming to YouTube this year',
  author: 'Neal Mohan',
  authorId: ORIGINAL_AUTHOR_ID,
  authorThumbnails: avatar('%23393'),
  publishedTime: now - 2 * 86400000,
  voteCount: 511,
  commentCount: 60,
  postContent: { type: 'image', content: [{ url: image, width: 640, height: 360 }] },
  type: 'community'
}

test.describe('shared community posts', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        hideSubscriptionsCommunity: false,
        useRssFeeds: false,
        listType: 'list'
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: SHARER_ID, name: 'Creator Insider', thumbnail: '' }]
      }],
      subscriptionCache: [{
        _id: SHARER_ID,
        communityPosts: [
          sharedPost('shared-post', 'Check out the latest from Neal', originalPost, 10),
          sharedPost('shared-deleted-post', 'This one was removed', null, 20)
        ],
        communityPostsTimestamp: new Date(now - 60000).toISOString()
      }]
    }
  })

  test('nests the original post inside the shared post', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const shared = page.locator('.ft-list-post.ft-list-item').filter({ hasText: 'Check out the latest from Neal' })
    await expect(shared.locator('.authorNameLink').first()).toHaveText('Creator Insider')
    // YouTube shows likes only on the original post
    await expect(shared.locator(':scope > .bottomSection .likeCount')).toHaveCount(0)
    await expect(shared.locator(':scope > .bottomSection .commentsLink')).toHaveAttribute('href', `#/post/shared-post?authorId=${SHARER_ID}`)

    const original = shared.locator('.sharedPostCard')
    await expect(original).toHaveCount(1)
    await expect(original.locator('.postText')).toHaveText(originalPost.postText)
    await expect(original.locator('.authorNameLink')).toHaveText('Neal Mohan')
    await expect(original.locator('.authorNameLink')).toHaveAttribute('href', `#/channel/${ORIGINAL_AUTHOR_ID}`)
    await expect(original.locator('img.communityImage')).toBeVisible()
    await expect(original.locator('.likeCount')).toHaveText('511')
    await expect(original.locator('.commentsLink')).toHaveAttribute('href', `#/post/original-post?authorId=${ORIGINAL_AUTHOR_ID}`)
    await expect(original.locator('.shareButton, .optionsButton')).toHaveCount(0)

    const deleted = page.locator('.ft-list-post.ft-list-item').filter({ hasText: 'This one was removed' })
    await expect(deleted.locator('.unavailablePost')).toHaveText('[Original post unavailable]')
    await expect(deleted.locator('.sharedPostCard')).toHaveCount(0)

    await attachScreenshot('shared community posts')

    await original.locator('.commentsLink').click()
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/post/original-post?authorId=${ORIGINAL_AUTHOR_ID}`)
  })
})
