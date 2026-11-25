import { test, expect } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { backendPreference: 'invidious', hideComments: true } } })

test('preserves the requested post comment sort when the response has no sort menu', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route('**/api/v1/post/**', route => route.fulfill({
    json: { comments: [{ commentId: 'e2e-post', contentHtml: 'Post', author: 'Test Channel', authorId: 'UC-test-channel-id', authorThumbnails: [{ url: 'https://example.com/avatar.png', width: 48, height: 48 }], publishedText: '1 day ago', likeCount: 0, replyCount: 0 }] }
  }))
  const continuations = []
  await page.route(/\/youtubei\/v1\/browse/, (route, request) => {
    continuations.push(request.postDataJSON().continuation)
    return route.fulfill({
      json: {
        onResponseReceivedEndpoints: [
          { reloadContinuationItemsCommand: { targetId: 'comments-section', continuationItems: [{ commentsHeaderRenderer: { countText: { simpleText: '0 Comments' } } }] } },
          { reloadContinuationItemsCommand: { targetId: 'comments-section', continuationItems: [] } }
        ]
      }
    })
  })
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/post/e2e-post', query: { authorId: 'UC-test-channel-id' } }))
  await expect(page.getByText('Post', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await window.$store.dispatch('updateBackendPreference', 'local')
    await window.$store.dispatch('updateBackendFallback', false)
    await window.$store.dispatch('updateHideComments', false)
  })
  const actions = page.locator('.noCommentActions')
  await expect(actions).toBeVisible()
  expect(continuations).toHaveLength(1)
  const topContinuation = continuations[0]
  await actions.getByRole('combobox').click()
  await page.getByRole('option', { name: /^newest first$/i }).click()
  await expect(actions).toBeVisible()
  expect(continuations).toHaveLength(2)
  expect(continuations[1]).not.toBe(topContinuation)
  await expect(actions.locator('.selectedValue')).toHaveText(/^newest first$/i)

  await actions.getByRole('button', { name: 'Reload Comments', exact: true }).click()
  await expect(actions).toBeVisible()
  expect(continuations).toHaveLength(3)
  expect(continuations[2]).toBe(continuations[1])
  await expect(actions.locator('.selectedValue')).toHaveText(/^newest first$/i)
  await actions.getByRole('combobox').click()
  await page.getByRole('option', { name: /^top comments$/i }).click()
  await expect(actions).toBeVisible()
  expect(continuations).toHaveLength(4)
  expect(continuations[3]).toBe(topContinuation)
  await expect(actions.locator('.selectedValue')).toHaveText(/^top comments$/i)
  await expect(page.locator('.toast', { hasText: 'Local API Error' })).toHaveCount(0)
})

test('Hide Comments controls post comments without hiding the post', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  let commentRequests = 0
  await page.route('**/api/v1/post/**', async route => {
    const isComments = new URL(route.request().url()).pathname.endsWith('/comments')
    if (isComments) commentRequests++
    await route.fulfill({
      json: isComments
        ? { comments: [], commentCount: 0 }
        : {
            comments: [{
              commentId: 'e2e-post',
              contentHtml: 'Post with optional comments',
              author: 'Test Channel',
              authorId: 'UC-test-channel-id',
              authorThumbnails: [{ url: 'https://example.com/avatar.png', width: 48, height: 48 }],
              publishedText: '1 day ago',
              likeCount: 3,
              replyCount: 0
            }]
          }
    })
  })
  await page.evaluate(() => {
    return window.ftElectron.tabs.create({ route: '/post/e2e-post', query: { authorId: 'UC-test-channel-id' } })
  })
  await expect(page.getByText('Post with optional comments', { exact: true })).toBeVisible()
  await expect(page.locator('.noComments')).toHaveCount(0)
  expect(commentRequests).toBe(0)

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateHideComments', false)
  })
  await expect.poll(() => commentRequests).toBeGreaterThan(0)
  expect(pageErrors).toEqual([])
  await expect(page.locator('.noComments')).toBeVisible()

  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateHideComments', true)
  })
  await expect(page.locator('.noComments')).toHaveCount(0)
  await expect(page.getByText('Post with optional comments', { exact: true })).toBeVisible()
})

test.describe('with a YouTube account', () => {
  const ACCOUNT_POST_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
  const POST_ID = 'UgkxExamplePostIdentifier0123456789'
  const comment = (commentId, text, replies) => ({
    commentId,
    contentHtml: text,
    author: '@someone',
    authorId: 'UCsomeone000000000000000',
    authorThumbnails: [],
    publishedText: '1 day ago',
    likeCount: 1,
    ...(replies ? { replies } : {})
  })

  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        youTubeAccount: {
          credentials: { access_token: 't', refresh_token: 'r', expiry_date: '2999-01-01T00:00:00.000Z', client: { client_id: 'c', client_secret: 's' } },
          profiles: [{ name: 'Test Channel', handle: '@testchannel', thumbnail: null, pageId: null }],
          pageId: null,
          channelId: 'UCtestchannel000000000000',
          signInId: 'x'
        }
      }
    }
  })

  test('a posted reply shows once after the thread replies load', async ({ page }) => {
    await page.route(/\/youtubei\/v1\/comment\/create_comment_reply/, route => route.fulfill({
      json: {
        actionResult: { status: 'STATUS_SUCCEEDED' },
        actions: [{ commentRenderer: { commentId: 'Ugthread.Ugnewreply', authorText: { simpleText: '@testchannel' } } }]
      }
    }))
    await page.route('**/api/v1/post/**', route => {
      const url = new URL(route.request().url())
      if (!url.pathname.endsWith('/comments')) {
        return route.fulfill({ json: { comments: [{ ...comment(POST_ID, 'A post', null), author: 'Example Channel', authorId: ACCOUNT_POST_CHANNEL_ID, replyCount: 1, authorThumbnails: [{ url: 'https://example.com/avatar.png', width: 48, height: 48 }] }] } })
      }
      if (url.searchParams.get('continuation') === 'replies1') {
        return route.fulfill({ json: { comments: [comment('Ugthread.Ugolder', 'Older reply'), comment('Ugthread.Ugnewreply', 'My reply')] } })
      }
      return route.fulfill({ json: { commentCount: 1, comments: [comment('Ugthread', 'Top comment', { replyCount: 1, continuation: 'replies1' })] } })
    })
    await page.evaluate(({ postId, authorId }) => window.ftElectron.tabs.create({ route: `/post/${postId}`, query: { authorId } }),
      { postId: POST_ID, authorId: ACCOUNT_POST_CHANNEL_ID })
    const thread = page.locator('.commentThread').filter({ hasText: 'Top comment' })
    await expect(thread).toBeVisible({ timeout: 30_000 })
    await thread.getByRole('button', { name: 'Reply', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Add a reply' }).fill('My reply')
    await thread.locator('.replyComposer').getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.locator('.toast', { hasText: 'Reply posted' })).toBeVisible()
    await expect(thread.locator('.commentText', { hasText: 'My reply' })).toHaveCount(1)
    // Loads the thread's replies, which include the posted one.
    const more = thread.getByRole('button', { name: 'Show more replies' })
    await more.click()
    await expect(thread.locator('.commentText', { hasText: 'Older reply' })).toBeVisible()
    await expect(thread.locator('.commentText', { hasText: 'My reply' })).toHaveCount(1)
  })
})
