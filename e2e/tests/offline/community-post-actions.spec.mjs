import { test, expect, goTo } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const now = Date.now()
const posts = [
  { postId: 'post-with-comments', postText: 'A community update', voteCount: 2200, commentCount: 123 },
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
      listType: 'list'
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

test('post counts have matching contrast and evenly spaced actions', { tag: '@scale' }, async ({ app, page, uiScale }) => {
  await openPosts(page)
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
    for (const width of [1280, 375]) {
      await app.electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), {
        width: Math.round(width * uiScale / 100), height: Math.round(850 * uiScale / 100)
      })
      await expect.poll(() => page.evaluate(() => Math.round(innerWidth))).toBeCloseTo(width, -1)
      await page.evaluate(() => document.fonts.ready)
      for (const hideSharingActions of [true, false]) {
        await page.evaluate(value => window.$store.dispatch('updateHideSharingActions', value), hideSharingActions)
        for (const post of await page.locator('.ft-list-post').all()) {
          const footer = post.locator('.bottomSection')
          const color = await footer.locator('.commentCount').evaluate(element => getComputedStyle(element).color)
          expect.soft(await footer.locator('.likeCount').evaluate(element => getComputedStyle(element).color)).toBe(color)
          const gaps = await footer.evaluate(element => {
            const selectors = ['.likeCount', '.commentCount', '.shareButton button .icon', '.optionsButton button .icon']
            const rects = selectors.flatMap(selector => {
              const child = element.querySelector(selector)
              if (!child) return []
              const range = document.createRange()
              range.selectNodeContents(child)
              return [selector.includes('button') ? child.getBoundingClientRect() : range.getBoundingClientRect()]
            })
            return rects.slice(1).map((rect, index) => rect.left - rects[index].right)
          })
          expect.soft(gaps.length).toBeGreaterThanOrEqual(2)
          expect.soft(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1)
          expect.soft(Math.min(...gaps)).toBeGreaterThanOrEqual(12)
        }
      }
    }
  }
})

test('copies the YouTube post link from the menu with sharing hidden', async ({ app, page }) => {
  await openPosts(page)
  for (const iconPack of ['material', 'remix']) {
    await page.evaluate(value => window.$store.dispatch('updateIconPack', value), iconPack)
    for (const [index, post] of (await page.locator('.ft-list-post').all()).entries()) {
      await post.getByRole('button', { name: 'More options', exact: true }).click()
      await page.getByRole('option', { name: 'Copy YouTube Link', exact: true }).click()
      await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(`https://www.youtube.com/post/${posts[index].postId}`)
      await expect(page.getByText('YouTube URL copied to clipboard', { exact: true }).last()).toBeVisible()
      await expect(page.getByRole('option', { name: 'Copy YouTube Link', exact: true })).toHaveCount(0)
    }
  }
})

test('hides the comment link without leaving an empty footer item', async ({ page }) => {
  await openPosts(page)
  await page.evaluate(() => window.$store.dispatch('updateHideComments', true))
  await expect(page.locator('.ft-list-post .commentsLink')).toHaveCount(0)
  await expect(page.locator('.ft-list-post .likeCount')).toHaveCount(posts.length)
  await expect(page.locator('.ft-list-post .optionsButton')).toHaveCount(posts.length)
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
