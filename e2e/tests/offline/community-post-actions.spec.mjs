import { test, expect, goTo } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const now = Date.now()
const posts = [
  { postId: 'post-with-comments', postText: 'A community update', voteCount: 2200, commentCount: 123 },
  { postId: 'post-with-one-comment', postText: 'An update with one comment', voteCount: 3, commentCount: 1 },
  { postId: 'post-with-zero-comments', postText: 'An update without comments', voteCount: 3, commentCount: 0 },
  { postId: 'post-without-count', postText: 'Another community update', voteCount: 3, commentCount: null }
].map(post => ({
  ...post,
  author: 'Example Channel',
  authorId: CHANNEL_ID,
  authorThumbnails: [],
  publishedTime: now - 60000,
  postContent: { type: 'text', content: null },
  type: 'community'
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsCommunity: false,
      hideSharingActions: true,
      useRssFeeds: false,
      listType: 'list',
      reducedMotion: 'on'
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: CHANNEL_ID, name: 'Example Channel', thumbnail: '' }]
    }],
    subscriptionCache: [{
      _id: CHANNEL_ID,
      communityPosts: posts,
      communityPostsTimestamp: new Date(now).toISOString()
    }]
  }
})

async function openPosts(page) {
  await goTo(page, 'subscriptions')
  await page.locator('[data-subscription-feed-tab="posts"]').click()
  await expect(page.locator('.ft-list-post')).toHaveCount(posts.length)
}

test('shows single and zero comment counts without claiming unknown counts are one', async ({ page }) => {
  await openPosts(page)
  for (const [index, count] of [[0, '123'], [1, '1'], [2, '0'], [3, '']]) {
    const countLabel = page.locator('.ft-list-post .commentCount').nth(index)
    await expect(countLabel).toHaveText(count)
    await expect(countLabel).toHaveAttribute('title', count === '' ? 'View Full Post' : `${count} comment${count === '1' ? '' : 's'}`)
  }
})

test('copies the YouTube post link from the menu with sharing hidden', async ({ app, page }) => {
  await openPosts(page)
  for (const [index, post] of (await page.locator('.ft-list-post').all()).entries()) {
    await post.getByRole('button', { name: 'More options', exact: true }).click()
    await page.getByRole('option', { name: 'Copy YouTube Link', exact: true }).click()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(`https://www.youtube.com/post/${posts[index].postId}`)
    await expect(page.getByText('YouTube URL copied to clipboard', { exact: true }).last()).toBeVisible()
    await expect(page.getByRole('option', { name: 'Copy YouTube Link', exact: true })).toHaveCount(0)
  }
})

test('copies a standalone post link for an unsubscribed author', async ({ app, page }) => {
  await page.route('**/api/v1/post/**', route => route.fulfill({
    json: {
      comments: [{
        commentId: 'standalone-post',
        contentHtml: 'A standalone community post',
        author: 'Another Channel',
        authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
        authorThumbnails: [],
        publishedText: '1 day ago',
        likeCount: 3,
        replyCount: 0
      }]
    }
  }))
  await page.evaluate(async () => {
    await window.$store.dispatch('updateBackendPreference', 'invidious')
    await window.$store.dispatch('updateHideComments', true)
    await window.ftElectron.tabs.create({ route: '/post/standalone-post', query: { authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa' } })
  })
  await expect(page.locator('.ft-list-post .postText')).toHaveText('A standalone community post')
  await page.locator('.ft-list-post').getByRole('button', { name: 'More options', exact: true }).click()
  await page.getByRole('option', { name: 'Copy YouTube Link', exact: true }).click()
  await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://www.youtube.com/post/standalone-post')
})
