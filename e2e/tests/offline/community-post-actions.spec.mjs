import { test, expect, goTo } from '../../helpers/app.mjs'
import { commentTranslationResponse, decodeCommentTranslationAction } from '../../helpers/innertube.mjs'

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

test('translates an Invidious post line by line and keeps its links', async ({ page }) => {
  const url = 'https://example.com/a-very-long-path-that-invidious-shortens'
  const translationRequests = []
  await page.route(/\/youtubei\/v1\/comment\/perform_comment_action/, (route, request) => {
    const { text } = decodeCommentTranslationAction(request.postData())
    translationRequests.push(text)
    // The service also translates the words in links and adds blank lines.
    const translated = 'Hello everyone, today we are showing you our new studio. #studio-en\n\nMore about baking: https://example.com/translated-path'
    return route.fulfill({ status: 200, contentType: 'application/json', body: commentTranslationResponse(translated) })
  })
  await page.route('**/api/v1/post/**', route => route.fulfill({
    json: {
      comments: [{
        commentId: 'translated-post',
        // Invidious separates lines with `<br>` and shortens link labels.
        contentHtml: `Hallo zusammen, heute zeigen wir euch unser neues Studio. #studio<br>Mehr über das Backen: <a href="${url}">example.com/a-very-long-path…</a>`,
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
    await window.ftElectron.tabs.create({ route: '/post/translated-post', query: { authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa' } })
  })

  const postText = page.locator('.ft-list-post .postText')
  const translate = page.locator('.ft-list-post .postTranslationButton')
  await translate.click()

  await expect(postText).toHaveText('Hello everyone, today we are showing you our new studio. #studio\nMore about baking: example.com/a-very-long-path-that-invidious-shortens')
  await expect(postText.getByRole('link', { name: '#studio' })).toHaveAttribute('href', /\/hashtag\/studio$/)
  await expect(postText.getByRole('link', { name: /^example\.com/ })).toHaveAttribute('href', url)
  expect(translationRequests).toEqual([`Hallo zusammen, heute zeigen wir euch unser neues Studio. #studio\nMehr über das Backen: ${url}`])

  await translate.click()
  await expect(postText).toContainText('Hallo zusammen')
})
