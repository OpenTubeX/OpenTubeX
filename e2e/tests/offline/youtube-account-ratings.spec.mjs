import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

const ACCESS_TOKEN = 'test-access-token'

test.use({
  seed: {
    settings: {
      ...WATCH_PAGE_SEED,
      youTubeAccount: {
        credentials: {
          access_token: ACCESS_TOKEN,
          refresh_token: 'test-refresh-token',
          // Far enough ahead that the sign-in is never refreshed.
          expiry_date: '2999-01-01T00:00:00.000Z',
          client: { client_id: 'test-client-id', client_secret: 'test-client-secret' }
        },
        profiles: [{ name: 'Test Channel', handle: '@testchannel', thumbnail: null, pageId: null }],
        pageId: null,
        channelId: 'UCtestchannel000000000000',
        signInId: 'test-sign-in'
      }
    }
  }
})

test('loads the video rating with the YouTube account only after opting in', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)

  let ratingRequests = 0
  await page.route(/\/youtubei\/v1\/next/, (route, request) => {
    if (request.headers().authorization !== `Bearer ${ACCESS_TOKEN}`) return route.fallback()
    ratingRequests++
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        frameworkUpdates: {
          entityBatchUpdate: { mutations: [{ payload: { likeStatusEntity: { likeStatus: 'LIKE' } } }] }
        }
      })
    })
  })

  await openMockedVideo(page)
  const likeButton = page.locator('.likeBarContainer .rateButton.likeCount')
  await expect(page.locator('.likeBarContainer')).toBeVisible()
  await expect(likeButton).toHaveCount(0)

  await page.evaluate(() => window.$store.dispatch('updateYouTubeAccountVideoRatings', true))

  await expect(likeButton).toHaveAttribute('aria-pressed', 'true')
  // A request sent before opting in would make this 2.
  expect(ratingRequests).toBe(1)

  // A lookup that waited for a rating still going out must not be sent after opting out.
  let writeStarted
  const writeStartedPromise = new Promise(resolve => { writeStarted = resolve })
  let releaseWrite
  const writeReleased = new Promise(resolve => { releaseWrite = resolve })
  await page.route(/\/youtubei\/v1\/like\//, async route => {
    writeStarted()
    await writeReleased
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  const setVideoRatings = enabled => page.evaluate(value => window.$store.dispatch('updateYouTubeAccountVideoRatings', value), enabled)

  await likeButton.click()
  await writeStartedPromise
  await setVideoRatings(false)
  await setVideoRatings(true)
  await setVideoRatings(false)
  await expect(likeButton).toHaveCount(0)
  releaseWrite()

  // The lookup after opting in again waits for the same write, so a stale one would go out first.
  await setVideoRatings(true)
  await expect(likeButton).toBeEnabled()
  expect(ratingRequests).toBe(2)
})
