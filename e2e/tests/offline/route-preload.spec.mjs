import { test, expect, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const now = Date.now()
const history = Array.from({ length: 3 }, (_, index) => ({
  _id: index === 0 ? 'jNQXAC9IVRw' : `routePreload${index}`,
  videoId: index === 0 ? 'jNQXAC9IVRw' : `routePreload${index}`,
  title: `Route preload video ${index}`,
  author: `Route preload channel ${index}`,
  authorId: `UCroutePreload${index}`,
  type: 'video',
  lengthSeconds: 30,
  watchProgress: 0,
  isWatched: false,
  timeWatched: now - index * 60_000,
}))

test.use({
  seed: {
    settings: {
      landingPage: 'history',
      fetchSubscriptionsAutomatically: false,
      enableHomeRecommendations: false,
      historyWatchedStatusMigrated: true,
    },
    history,
    playlists: [{
      _id: 'route-preload-playlist',
      playlistName: 'Route preload playlist',
      protected: false,
      description: '',
      videos: [],
      createdAt: now,
      lastUpdatedAt: now,
    }],
  },
})

/** Whether the route's component code has been loaded and resolved. */
function isRouteLoaded(page, path) {
  return page.evaluate(path => Boolean(
    window.$router.resolve(path).matched.at(-1).components.default.__asyncResolved
  ), path)
}

/** Records route placeholders, which only render while a view's code loads. */
function recordRoutePlaceholders(page) {
  return page.evaluate(() => {
    window.__routePlaceholders = 0
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('span[hidden][data-tab-loading-indicator]')) {
            window.__routePlaceholders++
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
}

test('resting the pointer on a video loads Watch without fetching it, and the click renders it directly', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const videoRequests = []
  page.on('request', (request) => {
    if (/\/youtubei\/v1\/(next|player)|\/api\/v1\/videos\//.test(request.url())) {
      videoRequests.push(request.url())
    }
  })

  const video = page.locator('.tabContent[aria-hidden="false"] .ft-list-video').first()
  await expect(video).toContainText('Route preload video 0')
  expect(await isRouteLoaded(page, '/watch/jNQXAC9IVRw')).toBe(false)
  const historyBefore = await page.evaluate(() => JSON.stringify(window.$store.getters.getHistoryCacheById))

  await video.locator('a.title').hover()
  await expect.poll(() => isRouteLoaded(page, '/watch/jNQXAC9IVRw')).toBe(true)

  // Loading the code must not mount, fetch, play or record the video.
  await page.waitForTimeout(500)
  expect(videoRequests).toEqual([])
  await expect(page).toHaveURL(/#\/history$/)
  await expect(page.locator('.videoLayout')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.stringify(window.$store.getters.getHistoryCacheById))).toBe(historyBefore)

  await recordRoutePlaceholders(page)
  await video.locator('a.title').click()
  await expect(page.locator('.tabContent[aria-hidden="false"] .videoLayout')).toBeVisible()
  expect(await page.evaluate(() => window.__routePlaceholders)).toBe(0)
  await expect.poll(() => videoRequests.length).toBeGreaterThan(0)
})

test('keyboard focus on a side navigation link loads its destination', async ({ page }) => {
  expect(await isRouteLoaded(page, '/userplaylists')).toBe(false)

  const link = page.locator(sel.sideNavLink('userplaylists')).first()
  await link.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  expect(await link.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await expect.poll(() => isRouteLoaded(page, '/userplaylists')).toBe(true)
  await expect(page).toHaveURL(/#\/history$/)

  await recordRoutePlaceholders(page)
  await page.keyboard.press('Enter')
  await expect(page.locator('.tabContent[aria-hidden="false"]')).toContainText('Route preload playlist')
  expect(await page.evaluate(() => window.__routePlaceholders)).toBe(0)
})

test('a route whose code failed to preload still opens on click', async ({ page }) => {
  await page.route(/^app:\/\/bundle\/.*\.js$/, route => route.abort())

  const link = page.locator('.tabContent[aria-hidden="false"] .ft-list-video a.channelName').first()
  const failedRequest = page.waitForEvent('requestfailed', request => request.url().startsWith('app://bundle/'))
  await link.hover()
  await failedRequest
  expect(await isRouteLoaded(page, '/channel/UCroutePreload0')).toBe(false)

  await page.unroute(/^app:\/\/bundle\/.*\.js$/)
  await page.mouse.move(0, 0)
  // A failed mount would recover by reloading the window, losing this marker.
  await page.evaluate(() => { window.__routePreloadSameDocument = true })
  await link.click()
  await expect(page).toHaveURL(/#\/channel\/UCroutePreload0/)
  await expect(page.locator('.tabContent[aria-hidden="false"] .routerView')).toBeAttached()
  await expect.poll(() => isRouteLoaded(page, '/channel/UCroutePreload0')).toBe(true)
  expect(await page.evaluate(() => window.__routePreloadSameDocument)).toBe(true)
})
