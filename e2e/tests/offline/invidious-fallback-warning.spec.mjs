import { test, expect, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const warning = 'This request bypasses your configured Invidious instance and connects directly to YouTube, exposing your IP address.'

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      backendPreference: 'invidious',
      backendFallback: true,
      defaultInvidiousInstance: 'https://invidious.test',
      enableSearchSuggestions: true,
      fetchSubscriptionsAutomatically: false,
    },
  },
})

test('warns once per direct fallback and respects disabled fallback @scale', async ({ page }, testInfo) => {
  await page.evaluate(() => {
    window.__directSuggestionRequests = []
    window.__invidiousSuggestionRequests = []
    window.__invidiousAvailable = false
    const originalFetch = window.fetch
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const query = url.searchParams.get('q')
      if (url.pathname.includes('/search/suggestions')) {
        window.__invidiousSuggestionRequests.push(query)
        const body = window.__invidiousAvailable ? { query, suggestions: [`${query} suggestion`] } : { error: 'Instance unavailable' }
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: window.__invidiousAvailable ? 200 : 503,
        }))
      }
      if (url.hostname.startsWith('suggestqueries')) {
        window.__directSuggestionRequests.push(query)
        return Promise.resolve(new Response(`window.google.ac.h(${JSON.stringify([query, [[`${query} suggestion`]]])})`))
      }
      return originalFetch(input, init)
    }
  })
  const input = page.locator(sel.searchInput)
  const warnings = page.getByRole('status').filter({ hasText: warning })
  const suggestions = page.locator('.topNav .options .list bdi')

  await input.fill('first query')
  await expect(suggestions).toHaveText(['first query suggestion'])
  await expect(warnings).toHaveCount(1)
  await expect(warnings).toBeVisible()
  const bounds = await warnings.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: testInfo.outputPath('invidious-fallback-warning.png') })

  await input.fill('second query')
  await expect(suggestions).toHaveText(['second query suggestion'])
  await expect(warnings).toHaveCount(2)
  expect(await page.evaluate(() => window.__directSuggestionRequests)).toEqual(['first query', 'second query'])

  await page.evaluate(() => window.$store.commit('setBackendFallback', false))
  await input.fill('disabled query')
  await expect.poll(() => page.evaluate(() => window.__invidiousSuggestionRequests)).toContain('disabled query')
  await expect(suggestions).toHaveCount(0)
  expect(await page.evaluate(() => window.__directSuggestionRequests)).toEqual(['first query', 'second query'])
  await expect(warnings).toHaveCount(2)

  await page.evaluate(() => {
    window.$store.commit('setBackendFallback', true)
    window.__invidiousAvailable = true
  })
  await input.fill('working query')
  await expect(suggestions).toHaveText(['working query suggestion'])
  expect(await page.evaluate(() => window.__directSuggestionRequests)).toEqual(['first query', 'second query'])
  await expect(warnings).toHaveCount(2)
})

test('warns when video playback falls back to the direct extractor', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route('https://invidious.test/api/v1/videos/**', route => route.fulfill({
    status: 503, json: { error: 'Instance unavailable' },
  }))
  await page.evaluate(() => {
    window.$store.commit('setHideComments', true)
    window.$store.commit('setEnableSearchSuggestions', false)
  })
  let directRequests = 0
  page.on('request', request => {
    if (request.url().includes('/youtubei/v1/player')) directRequests++
  })
  await page.locator(sel.searchInput).fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
  const warnings = page.getByRole('status').filter({ hasText: warning })
  await expect(warnings).toHaveCount(1)
  await expect(warnings).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)
  expect(directRequests).toBeGreaterThan(0)
  await expect(warnings).toHaveCount(1)
})
