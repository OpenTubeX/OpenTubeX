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
