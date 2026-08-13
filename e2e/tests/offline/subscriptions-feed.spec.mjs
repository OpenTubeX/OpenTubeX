import { test, expect, goTo } from '../../helpers/app.mjs'
import { IpcChannels } from '../../../src/constants.js'

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
    // Invidious includes this sentinel value for videos that are not premieres.
    premiereTimestamp: 0,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    type: 'video',
    ...extra
  }
}

// Auto-fetch is disabled so the feed must come entirely from the seeded
// cache — this is exactly the offline startup path the app uses before
// any refresh (53caa4084, 7ad96d185).
const seed = {
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
        feedVideo('aaaaaaaaaa3', 'Upcoming premiere video', CHANNEL_A, now + 30 * 24 * HOUR, {
          premiereDate: new Date(now + 30 * 24 * HOUR).toISOString()
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

test.use({ seed })

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
    await expect(runningPremiere.locator('.viewCount')).toContainText('1k watching')

    const titles = page.locator('.ft-list-video .title, [class*="videoTitle"]')
    await expect(titles.nth(0)).toContainText('Video B newest')
    await expect(titles.nth(1)).toContainText('Video A newer')
    await expect(titles.nth(2)).toContainText('Running premiere video')
    await expect(titles.nth(3)).toContainText('Video A older')

    // The subscription feed honours the hide-upcoming-premieres setting.
    await expect(page.getByText('Upcoming premiere video')).toHaveCount(0)
  })

  test('shows a hidden upcoming premiere when its scheduled time arrives', async ({ page }) => {
    // The app opens on Subscriptions, so leave it before installing the clock;
    // timers created before installation cannot be advanced by Playwright.
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Upcoming premiere video')).toHaveCount(0)

    await page.clock.fastForward(24 * 24 * HOUR)
    await page.clock.fastForward(6 * 24 * HOUR + 1000)

    const premiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await expect(premiere).toBeVisible()
    await expect(premiere.locator('.videoDuration')).toHaveText('Live')
  })

  test('an open video menu does not lift feed content over the sticky header', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const video = page.locator('.ft-list-video').first()
    await expect(video).toBeVisible()
    await video.hover()
    await video.locator('.optionsButton').click()
    await expect(video.locator('.iconDropdown')).toBeVisible()

    const headerCoversVideo = await page.evaluate(() => {
      const header = document.querySelector('.subscriptionsHeader')
      const video = document.querySelector('.ft-list-video')
      const initialHeaderRect = header.getBoundingClientRect()
      const initialVideoRect = video.getBoundingClientRect()
      window.scrollBy(0, initialVideoRect.top - initialHeaderRect.top + 20)

      const headerRect = header.getBoundingClientRect()
      const thumbnailRect = video.querySelector('.videoThumbnail').getBoundingClientRect()
      const elementAtHeader = document.elementFromPoint(
        thumbnailRect.left + thumbnailRect.width / 2,
        headerRect.bottom - 5
      )
      return header.contains(elementAtHeader)
    })

    expect(headerCoversVideo).toBe(true)
  })

  test('does not offer to mark a running premiere as watched', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const runningPremiere = page.locator('.ft-list-video').filter({ hasText: 'Running premiere video' })
    await runningPremiere.hover()
    await runningPremiere.locator('.optionsButton').click()

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Add to Queue' })).toBeVisible()
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

  test('updates relative timestamps without reloading the page', async ({ page }) => {
    // Install the clock before mounting the feed so its shared interval is controlled.
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'subscriptions')

    const newestVideo = page.locator('.ft-list-video').filter({ hasText: 'Video B newest' })
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('• 30 minutes ago')

    await page.clock.fastForward(31 * 60_000)

    await expect(newestVideo.locator('.uploadedTime')).toHaveText('• 1 hour ago')
  })
})

test.describe('subscriptions feed with a partially cached profile', () => {
  test.use({
    seed: {
      ...seed,
      subscriptionCache: [seed.subscriptionCache[0]]
    }
  })

  test('keeps cached videos visible when automatic fetching is disabled', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('Video A newer')).toBeVisible()
    await expect(page.getByText('Video A older')).toBeVisible()
    await expect(page.getByText('Video B newest')).toHaveCount(0)
  })
})

test.describe('relative timestamp updates disabled', () => {
  test.use({
    seed: {
      ...seed,
      settings: {
        ...seed.settings,
        updateRelativeTimestamps: false
      }
    }
  })

  test('keeps relative timestamps fixed until the page is revisited', async ({ page }) => {
    await goTo(page, 'trending')
    await page.clock.install({ time: now })
    await goTo(page, 'subscriptions')

    const newestVideo = page.locator('.ft-list-video').filter({ hasText: 'Video B newest' })
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('• 30 minutes ago')

    await page.clock.fastForward(31 * 60_000)
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('• 30 minutes ago')

    await goTo(page, 'trending')
    await goTo(page, 'subscriptions')
    await expect(newestVideo.locator('.uploadedTime')).toHaveText('• 1 hour ago')
  })
})

test.describe('subscriptions feed with upcoming premieres shown', () => {
  test.use({
    seed: {
      ...seed,
      settings: { ...seed.settings, hideUpcomingPremieres: false }
    }
  })

  test('does not offer to mark an upcoming premiere as watched', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await expect(upcomingPremiere).toBeVisible()
    await upcomingPremiere.hover()
    await upcomingPremiere.locator('.optionsButton').click()

    await expect(page.getByRole('option', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Add to Queue' })).toBeVisible()
  })

  test('toggles a reminder from the rightmost thumbnail action', async ({ app }) => {
    await app.electronApp.evaluate(({ Notification }) => {
      Notification.isSupported = () => true
    })

    const page = app.page
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    const reminderButton = upcomingPremiere.getByRole('button', { name: 'Notify me' })
    await expect(reminderButton).toBeVisible()
    await expect(reminderButton).toHaveAttribute('aria-pressed', 'false')

    const isRightmost = await reminderButton.evaluate(button => {
      const actions = button.closest('.playlistIcons')
      return Math.abs(button.getBoundingClientRect().right - actions.getBoundingClientRect().right) < 1
    })
    expect(isRightmost).toBe(true)

    await reminderButton.click()
    await expect(upcomingPremiere.getByRole('button', { name: 'Notification on' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  test('cleans up repeated live-reminder subscriptions independently', async ({ app, page }) => {
    await page.evaluate(() => {
      window.liveReminderUpdates = 0
      const handler = () => { window.liveReminderUpdates++ }
      window.removeFirstLiveReminderSubscription = window.ftElectron.liveReminder.onUpdated(handler)
      window.removeSecondLiveReminderSubscription = window.ftElectron.liveReminder.onUpdated(handler)
    })

    const sendUpdate = () => app.electronApp.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, 'video-id', true)
    }, IpcChannels.LIVE_REMINDER_UPDATED)

    await sendUpdate()
    await expect.poll(() => page.evaluate(() => window.liveReminderUpdates)).toBe(2)

    await page.evaluate(() => window.removeFirstLiveReminderSubscription())
    await sendUpdate()
    await expect.poll(() => page.evaluate(() => window.liveReminderUpdates)).toBe(3)

    await page.evaluate(() => window.removeSecondLiveReminderSubscription())
    await sendUpdate()
    await expect.poll(() => page.evaluate(() => window.liveReminderUpdates)).toBe(3)
  })

  test('does not render adjacent separators in the upcoming-video menu', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const upcomingPremiere = page.locator('.ft-list-video').filter({ hasText: 'Upcoming premiere video' })
    await upcomingPremiere.locator('.optionsButton').click()
    const menu = upcomingPremiere.locator('.iconDropdown')
    await expect(menu).toBeVisible()
    await expect(menu.locator('.listItemDivider + .listItemDivider')).toHaveCount(0)
  })
})
