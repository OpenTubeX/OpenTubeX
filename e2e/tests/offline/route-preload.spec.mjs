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

// On CI, the Channel code twice finished loading after the test blocked the
// bundle although no hover requested it. Record the bundle requests and the
// pointer and focus events on links from window creation on, which show what
// started that load.
let bundleRequests = []

/** Records pointer and focus events on internal links in `window.__e2eEvents`. */
function recordLinkEvents() {
  if (window.__routePreloadLinkEvents) return
  window.__routePreloadLinkEvents = true
  const events = window.__e2eEvents ??= []
  for (const type of ['pointerover', 'pointermove', 'focusin']) {
    document.addEventListener(type, (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null
      if (!link) return
      events.push({
        t: Date.now(),
        type,
        link: link.getAttribute('href'),
        ...(event instanceof PointerEvent
          ? { pointerType: event.pointerType, x: event.clientX, y: event.clientY }
          : { focusVisible: link.matches(':focus-visible') }),
      })
    }, { capture: true, passive: true })
  }
}

test.use({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a fixture object
  onPhase: async ({}, use) => use(async (phase, page) => {
    if (phase !== 'windowCreated') return
    bundleRequests = []
    page.on('request', (request) => {
      if (request.url().startsWith('app://bundle/') && request.url().endsWith('.js')) {
        bundleRequests.push({ t: Date.now(), url: request.url() })
      }
    })
    await page.addInitScript(recordLinkEvents)
    // The window may still be navigating to the app, which the init script covers.
    await page.evaluate(recordLinkEvents).catch(() => {})
  }),
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
  const blockedAt = Date.now()

  const link = page.locator('.tabContent[aria-hidden="false"] .ft-list-video a.channelName').first()
  let preloadFailed = false
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('app://bundle/')) preloadFailed = true
  })
  expect(await isRouteLoaded(page, '/channel/UCroutePreload0')).toBe(false)
  // The worker's Xvfb pointer rests on the page. Its first pointer event can
  // arrive just after a hover right at startup and move the intent off the
  // link, so hover again until the preload is requested.
  try {
    await expect(async () => {
      await page.mouse.move(0, 0)
      await link.hover()
      await expect.poll(() => preloadFailed, { timeout: 1000 }).toBe(true)
    }).toPass({ timeout: 20_000 })
  } catch (error) {
    // On CI, no hover in a whole run requested the code, which had loaded.
    // The link events are attached with the failure.
    await test.info().attach('route preload state', {
      body: JSON.stringify({
        channelLoaded: await isRouteLoaded(page, '/channel/UCroutePreload0'),
        blockedAt,
        bundleRequests,
      }, null, 2),
      contentType: 'application/json',
    })
    throw error
  }
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
