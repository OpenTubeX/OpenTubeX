import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const HOUR = 3_600_000

const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_B = 'UCbbbbbbbbbbbbbbbbbbbbbb'

function feedVideo(videoId, title, authorId, published, extra = {}) {
  return {
    videoId,
    title,
    author: authorId === CHANNEL_A ? 'Channel A' : 'Channel B',
    authorId,
    published,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    ...extra
  }
}

// Auto-fetch is disabled so the feed must come entirely from the seeded
// cache — this is exactly the offline startup path the app uses before
// any refresh (53caa4084, 7ad96d185).
test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideUpcomingPremieres: true,
      thumbnailSize: 180
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: CHANNEL_A, name: 'Channel A', thumbnail: '' },
          { id: CHANNEL_B, name: 'Channel B', thumbnail: '' }
        ]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_A,
        videos: [
          feedVideo('aaaaaaaaaa1', 'Video A newer', CHANNEL_A, now - 1 * HOUR),
          feedVideo('aaaaaaaaaa4', 'Running premiere video', CHANNEL_A, now - 2 * HOUR, {
            isPremiere: true,
            liveNow: true
          }),
          feedVideo('aaaaaaaaaa2', 'Video A older', CHANNEL_A, now - 3 * HOUR),
          feedVideo('aaaaaaaaaa3', 'Upcoming premiere video', CHANNEL_A, now + 24 * HOUR, {
            isUpcoming: true,
            premiereDate: new Date(now + 24 * HOUR).toISOString()
          })
        ],
        videosTimestamp: new Date(now - 2 * HOUR).toISOString()
      },
      {
        _id: CHANNEL_B,
        videos: [
          feedVideo('bbbbbbbbbb1', 'Video B newest', CHANNEL_B, now - 0.5 * HOUR)
        ],
        videosTimestamp: new Date(now - 1 * HOUR).toISOString()
      }
    ]
  }
})

test.describe('subscriptions feed from cache', () => {
  test('does not animate cards while calculating the initial grid size', async ({ page }) => {
    await page.evaluate(() => {
      window.__subscriptionFeedMoveClasses = []

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.target.classList.contains('feed-move')) {
            window.__subscriptionFeedMoveClasses.push(mutation.target.className)
          }
        }
      })

      observer.observe(document.querySelector('.app'), {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      })
    })

    await goTo(page, 'subscriptions')
    await expect(page.getByText('Video A older')).toBeVisible()
    await page.waitForTimeout(350)

    const moveClasses = await page.evaluate(() => window.__subscriptionFeedMoveClasses)
    expect(moveClasses).toEqual([])
  })

  test('renders the cached feed offline, newest first across channels', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Video B newest')).toBeVisible()
    await expect(page.getByText('Video A newer')).toBeVisible()
    await expect(page.getByText('Running premiere video')).toBeVisible()
    await expect(page.getByText('Video A older')).toBeVisible()

    const runningPremiere = page.locator('.ft-list-video').filter({ hasText: 'Running premiere video' })
    await expect(runningPremiere.locator('.videoDuration')).toHaveText('Premiere')

    const titles = page.locator('.ft-list-video .title, [class*="videoTitle"]')
    await expect(titles.nth(0)).toContainText('Video B newest')
    await expect(titles.nth(1)).toContainText('Video A newer')
    await expect(titles.nth(2)).toContainText('Running premiere video')
    await expect(titles.nth(3)).toContainText('Video A older')

    // The subscription feed honours the hide-upcoming-premieres setting.
    await expect(page.getByText('Upcoming premiere video')).toHaveCount(0)
  })

  test('shows when the cache was last refreshed, from the oldest channel timestamp', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Video B newest')).toBeVisible()

    // Cache timestamps must survive the IPC round trip as dates (7ad96d185).
    // The displayed value is the oldest per-channel timestamp (2 hours ago).
    const lastRefresh = page.locator('.lastRefreshTimestamp').first()
    await expect(lastRefresh).toBeVisible()
    await expect(lastRefresh).toContainText('2 hours ago')
  })
})
