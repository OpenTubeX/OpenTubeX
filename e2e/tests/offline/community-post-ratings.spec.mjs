import { test, expect, goTo } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const POST_ID = 'UgkxExamplePostIdentifier0123456789'
const now = Date.now()
const cached = {
  postId: POST_ID,
  postText: 'Where to next?',
  voteCount: 1840,
  commentCount: 3,
  author: 'Example Channel',
  authorId: CHANNEL_ID,
  authorThumbnails: [],
  publishedTime: now - 86400000,
  type: 'community',
  postContent: { type: 'text', content: null }
}

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      hideComments: true,
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsCommunity: false,
      useRssFeeds: false,
      youTubeAccountVideoRatings: true,
      youTubeAccount: {
        credentials: { access_token: 't', refresh_token: 'r', expiry_date: '2999-01-01T00:00:00.000Z', client: { client_id: 'c', client_secret: 's' } },
        profiles: [{ name: 'Test Channel', handle: '@testchannel', thumbnail: null, pageId: null }],
        pageId: null,
        channelId: 'UCtestchannel000000000000',
        signInId: 'x'
      }
    },
    profiles: [{ _id: 'allChannels', name: 'All Channels', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [{ id: CHANNEL_ID, name: 'Example Channel', thumbnail: '' }] }],
    subscriptionCache: [{ _id: CHANNEL_ID, communityPosts: [cached, { ...cached, postId: 'UgkxExamplePollIdentifier01234567890', voteCount: 5, postContent: { type: 'poll', totalVotes: 52, content: [{ text: 'Mountains', image: null }, { text: 'Beach', image: null }] } }], communityPostsTimestamp: new Date(now).toISOString() }]
  }
})

test('post ratings and votes count once and follow what YouTube confirmed', async ({ page }) => {
  const sent = []
  /** @type {Promise<void> | null} the next request fails once this settles */
  let failNext = null
  await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, async route => {
    const bytes = Buffer.from(decodeURIComponent(route.request().postDataJSON().actions[0]), 'base64')
    const type = bytes[1]
    // Field 7 follows the post ID: type, then 0x1a, length, ID, 0x38, value.
    const undo = bytes[4 + bytes[3] + 1]
    const action = { 5: undo ? 'unlike' : 'like', 4: undo ? 'undislike' : 'dislike' }[type]
    if (failNext) {
      const released = failNext
      failNext = null
      sent.push(action + ' (failed)')
      await released
      return route.fulfill({ json: { actionResults: [{ status: 'STATUS_FAILED' }] } })
    }
    sent.push(action)
    return route.fulfill({ json: { actionResults: [{ status: 'STATUS_SUCCEEDED' }] } })
  })
  await page.route('**/api/v1/post/**', route => route.fulfill({
    json: {
      comments: [{
        commentId: POST_ID,
        contentHtml: 'Where to next?',
        author: 'Example Channel',
        authorId: CHANNEL_ID,
        authorThumbnails: [],
        publishedText: '1 day ago',
        likeCount: 1841,
        replyCount: 3
      }]
    }
  }))

  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="posts"]').click()
  const card = page.locator('.ft-list-post').first()
  const like = card.getByRole('button', { name: /^Like/ })
  await like.click()
  await expect(like).toContainText('1,841')

  // A newer load that includes the like: unliking subtracts it, liking again adds it back.
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/post/${id}`, query: { authorId: 'UCbbbbbbbbbbbbbbbbbbbbbb' } }), POST_ID)
  const fresh = page.locator('.ft-list-post').last()
  const freshLike = fresh.getByRole('button', { name: /^Like/ })
  await expect(freshLike).toContainText('1,841')
  await freshLike.click()
  await expect(freshLike).toHaveAttribute('aria-pressed', 'false')
  await expect(freshLike).toContainText('1,840')
  await freshLike.click()
  await expect(freshLike).toContainText('1,841')
  await expect.poll(() => sent.length).toBe(3)

  // Liked: Dislike fails while Dislike again waits, which then goes out from the confirmed like.
  let release
  failNext = new Promise(resolve => { release = resolve })
  const dislike = fresh.getByRole('button', { name: 'Dislike' })
  await dislike.click()
  await expect.poll(() => sent.length).toBe(4)
  await dislike.click()
  release()
  await expect.poll(() => sent.length).toBe(5)
  await expect(page.locator('.toast', { hasText: 'Could not rate' })).toBeVisible()
  expect(sent).toEqual(['like', 'unlike', 'like', 'dislike (failed)', 'unlike'])
  await expect(freshLike).toHaveAttribute('aria-pressed', 'false')
  await expect(dislike).toHaveAttribute('aria-pressed', 'false')
  await expect(freshLike).toContainText('1,840')

  // Polls: vote, move the vote, take it back, which names the voted choice.
  sent.length = 0
  await page.route(/\/youtubei\/v1\/browse/, route => route.fulfill({ json: {} }))
  await page.unroute(/\/youtubei\/v1\/comment\/perform_comment_action/)
  await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, route => {
    const bytes = Buffer.from(decodeURIComponent(route.request().postDataJSON().actions[0]), 'base64')
    sent.push(`${bytes[1] === 9 ? 'vote' : 'unvote'} ${bytes[bytes.length - 1]}`)
    return route.fulfill({ json: { actionResults: [{ status: 'STATUS_SUCCEEDED' }] } })
  })
  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="posts"]:visible').click()
  const poll = page.locator('.ft-list-post:visible').filter({ has: page.locator('.poll') }).first()
  const choices = poll.locator('button.option')
  await choices.nth(0).click()
  await expect(poll.locator('.vote-count')).toContainText('53')
  await choices.nth(1).click()
  await choices.nth(1).click()
  await expect.poll(() => sent).toEqual(['vote 0', 'vote 1', 'unvote 1'])
  await expect(poll.locator('.vote-count')).toContainText('52')
})
