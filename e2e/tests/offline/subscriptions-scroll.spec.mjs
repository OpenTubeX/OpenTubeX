import { test, expect } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const SUBSCRIPTIONS_TAB_ID = 'e2e-scroll-subscriptions-tab'
const WATCH_TAB_ID = 'e2e-scroll-watch-tab'

const videos = Array.from({ length: 80 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `Feed video ${String(index).padStart(2, '0')}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3_600_000,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  isUpcoming: false,
  type: 'video'
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      rememberTabNavigationHistory: true,
      startupBehavior: 'loadLastActiveTab'
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_ID,
        videos,
        videosTimestamp: new Date(now).toISOString()
      }
    ],
    tabSessions: [
      {
        _id: 'e2e-subscriptions-scroll-session',
        value: {
          tabs: [
            {
              id: SUBSCRIPTIONS_TAB_ID,
              url: 'app://bundle/index.html#/subscriptions',
              title: 'Subscriptions',
              history: [
                {
                  route: { path: '/subscriptions', fullPath: '/subscriptions' },
                  title: 'Subscriptions',
                  scroll: { left: 0, top: 0 }
                }
              ],
              historyIndex: 0
            },
            {
              id: WATCH_TAB_ID,
              url: 'app://bundle/index.html#/watch/jNQXAC9IVRw',
              title: 'Video',
              history: [
                {
                  route: { path: '/watch/jNQXAC9IVRw', fullPath: '/watch/jNQXAC9IVRw' },
                  title: 'Video',
                  scroll: { left: 0, top: 600 }
                }
              ],
              historyIndex: 0
            }
          ],
          activeTabId: WATCH_TAB_ID,
          bounds: { x: 0, y: 0, width: 1600, height: 900, maximized: false }
        }
      }
    ]
  }
})

test('rapid switching from a restored video keeps subscriptions at the top', async ({ page }) => {
  const subscriptionsTab = page.locator(`.tab[data-tab-id="${SUBSCRIPTIONS_TAB_ID}"]`)
  const watchTab = page.locator(`.tab[data-tab-id="${WATCH_TAB_ID}"]`)

  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.style.blockSize = '2000px'
    document.querySelector('.tabContent[aria-hidden="false"]')?.append(spacer)
    window.scrollTo(0, 600)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)

  const subscriptionsContent = page.locator(`.tabContent[data-tab-id="${SUBSCRIPTIONS_TAB_ID}"]`)
  const watchContent = page.locator(`.tabContent[data-tab-id="${WATCH_TAB_ID}"]`)

  await subscriptionsTab.click()
  await expect(subscriptionsContent).toHaveAttribute('aria-hidden', 'false')
  await watchTab.click()
  await expect(watchContent).toHaveAttribute('aria-hidden', 'false')
  await subscriptionsTab.click()

  await expect(subscriptionsContent).toHaveAttribute('aria-hidden', 'false')
  await expect.poll(async () => {
    return (await page.evaluate(() => window.ftElectron.tabs.getState())).presentedTabId
  }).toBe(SUBSCRIPTIONS_TAB_ID)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(subscriptionsContent.getByText('Feed video 00')).toBeVisible()
  await expect.poll(() => subscriptionsContent.locator('.ft-list-video').count()).toBeGreaterThan(15)
})
