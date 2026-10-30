import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { backendPreference: 'invidious', hideComments: true } } })

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

test.describe('subscribed comment authors', () => {
  test.use({
    seed: {
      settings: { backendPreference: 'invidious', fetchSubscriptionsAutomatically: false, generalAutoLoadMorePaginatedItemsEnabled: true },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#d50000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: 'UC-subscribed-author', name: 'Subscribed author', thumbnail: '' }]
      }]
    }
  })

  test('marks comments and replies from subscribed channels with the Subscribed badge', async ({ page }) => {
    const comment = (author, authorId, extra = {}) => ({
      commentId: author,
      author,
      authorId,
      authorThumbnails: [],
      contentHtml: `${author} content`,
      published: 1_700_000_000,
      likeCount: 0,
      ...extra
    })
    await page.route('**/api/v1/post/**', route => {
      const url = new URL(route.request().url())
      if (!url.pathname.endsWith('/comments')) {
        return route.fulfill({ json: { comments: [{ commentId: 'e2e-post', contentHtml: 'Post', author: 'Test Channel', authorId: 'UC-test-channel-id', authorThumbnails: [{ url: 'https://example.com/avatar.png', width: 48, height: 48 }], publishedText: '1 day ago', likeCount: 0, replyCount: 0 }] } })
      }
      return route.fulfill({
        json: url.searchParams.get('continuation') === 'replies'
          ? { comments: [comment('Subscribed reply', 'UC-subscribed-author')] }
          : {
              comments: [
                comment('Subscribed author', 'UC-subscribed-author', { replies: { replyCount: 1, continuation: 'replies' } }),
                comment('Other author', 'UC-other-author')
              ],
              commentCount: 2
            }
      })
    })
    await page.evaluate(() => {
      return window.ftElectron.tabs.create({ route: '/post/e2e-post', query: { authorId: 'UC-test-channel-id' } })
    })

    const subscribed = page.locator('#comment0')
    const subscribedBadge = subscribed.locator(':scope > .commentAuthorWrapper .commentSubscribedIcon')
    await expect(subscribedBadge).toHaveAttribute('data-icon', 'user-check')
    await expect(subscribed.getByRole('img', { name: 'Subscribed', exact: true })).toBeVisible()
    await expect(page.locator('#comment1 .commentSubscribedIcon')).toHaveCount(0)

    await subscribed.locator('.commentReplyToggleLabel').click()
    const reply = page.locator('.commentReplyContent', { hasText: 'Subscribed reply' })
    await expect(reply.getByRole('img', { name: 'Subscribed', exact: true })).toBeVisible()
  })
})
