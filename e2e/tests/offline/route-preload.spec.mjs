import { test, expect } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const now = Date.now()
// One card only: each worker's Xvfb parks the real pointer at the screen
// center, which rests on the info line of a third grid card. A layout shift
// there could put its channel link under the pointer and preload the Channel
// code before a test blocks or watches for it.
const history = Array.from({ length: 1 }, (_, index) => ({
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

test('a route whose code failed to preload still opens on click', async ({ page }) => {
  await page.route(/^app:\/\/bundle\/.*\.js$/, route => route.abort())

  const link = page.locator('.tabContent[aria-hidden="false"] .ft-list-video a.channelName').first()
  const failedRequest = page.waitForEvent('requestfailed', request => request.url().startsWith('app://bundle/'))
  // On CI, the hover once never requested the route's code. Record the
  // events that start or cancel the preload intent for the failure report.
  await page.evaluate(() => {
    const events = window.__e2eEvents ??= []
    const describe = (target) => {
      if (!(target instanceof Element)) return target === document ? 'document' : String(target)
      const link = target.closest('a[href^="#/"]')?.getAttribute('href')
      return [target.tagName.toLowerCase(), ...target.classList].join('.') + (link ? ` in ${link}` : '')
    }
    for (const type of ['pointermove', 'pointerout', 'pointerdown', 'focusin', 'focusout', 'scroll']) {
      document.addEventListener(type, (event) => {
        events.push({
          t: Math.round(performance.now()),
          type,
          target: describe(event.target),
          ...(event instanceof PointerEvent ? { pointerType: event.pointerType, relatedTarget: event.relatedTarget && describe(event.relatedTarget) } : {}),
        })
      }, { capture: true, passive: true })
    }
  })
  expect(await isRouteLoaded(page, '/channel/UCroutePreload0')).toBe(false)
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
