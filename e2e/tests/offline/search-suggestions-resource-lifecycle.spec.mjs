import { test, expect, sel } from '../../helpers/app.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

for (const backendPreference of ['local', 'invidious']) {
  test.describe(`${backendPreference} suggestions`, () => {
    test.use({ seed: { settings: { backendPreference, backendFallback: true, enableSearchSuggestions: true, fetchSubscriptionsAutomatically: false } } })
    test('cancels obsolete suggestions when replacing, clearing, blurring and submitting queries', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.evaluate(() => {
        window.__suggestionRequests = []
        const originalFetch = window.fetch
        window.fetch = (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input.toString())
          if (!url.hostname.startsWith('suggestqueries') && !url.pathname.includes('/search/suggestions')) return originalFetch(input, init)
          const request = { query: url.searchParams.get('q'), aborted: false }
          window.__suggestionRequests.push(request)
          return new Promise((resolve, reject) => {
            const abort = () => { request.aborted = true; reject(new DOMException('Aborted', 'AbortError')) }
            if (init?.signal?.aborted) abort()
            else init?.signal?.addEventListener('abort', abort, { once: true })
          })
        }
      })
      const input = page.locator(sel.searchInput)
      const requests = () => page.evaluate(() => window.__suggestionRequests)
      await input.fill('first query')
      await expect.poll(async () => (await requests()).length).toBe(1)
      await input.fill('second query')
      await expect.poll(async () => (await requests())[0].aborted).toBe(true)
      await expect.poll(async () => (await requests()).length).toBe(2)
      await input.fill('')
      await expect.poll(async () => (await requests())[1].aborted).toBe(true)
      await input.fill('third query')
      await expect.poll(async () => (await requests()).length).toBe(3)
      await input.blur()
      await expect.poll(async () => (await requests())[2].aborted).toBe(true)
      await input.focus()
      await expect.poll(async () => (await requests()).length).toBe(4)
      await input.blur()
      await expect.poll(async () => (await requests())[3].aborted).toBe(true)
      await input.fill('https://www.youtube.com/watch?v=jNQXAC9IVRw')
      await expect.poll(async () => (await requests()).length).toBe(5)
      await input.press('Enter')
      await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw/)
      await expect.poll(async () => (await requests()).every(request => request.aborted)).toBe(true)
      // No further request may start after navigation.
      await page.waitForTimeout(300)
      expect((await requests()).length).toBe(5)
    })

    test('shows current suggestions and ignores a late response for an older query', async ({ page }) => {
      await page.evaluate(() => {
        window.__pendingSuggestions = new Map()
        window.__suggestionQueries = []
        const originalFetch = window.fetch
        window.fetch = (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input.toString())
          const local = url.hostname.startsWith('suggestqueries')
          if (!local && !url.pathname.includes('/search/suggestions')) return originalFetch(input, init)
          const query = url.searchParams.get('q')
          window.__suggestionQueries.push(query)
          // Deliberately ignore cancellation to exercise the stale-response guard.
          return new Promise(resolve => window.__pendingSuggestions.set(query, suggestion => {
            window.__pendingSuggestions.delete(query)
            const body = local
              ? `window.google.ac.h(${JSON.stringify([query, [[suggestion]]])})`
              : JSON.stringify({ query, suggestions: [suggestion] })
            resolve(new Response(body, { status: 200 }))
          }))
        }
      })
      const input = page.locator(sel.searchInput)
      await input.fill('old')
      await expect.poll(() => page.evaluate(() => window.__pendingSuggestions.has('old'))).toBe(true)
      await input.fill('new')
      await expect.poll(() => page.evaluate(() => window.__pendingSuggestions.has('new'))).toBe(true)
      await page.evaluate(() => window.__pendingSuggestions.get('new')('new current suggestion'))
      const options = page.locator('.topNav .options .list bdi')
      await expect(options).toHaveText(['new current suggestion'])
      await page.evaluate(() => window.__pendingSuggestions.get('old')('old stale suggestion'))
      // These waits prove that nothing changes or refetches.
      await page.waitForTimeout(300)
      await expect(options).toHaveText(['new current suggestion'])
      // Same-query events and refocusing can reuse completed results.
      await input.dispatchEvent('input')
      await page.waitForTimeout(300)
      expect(await page.evaluate(() => window.__suggestionQueries)).toEqual(['old', 'new'])
      await input.blur()
      await input.focus()
      await page.waitForTimeout(300)
      expect(await page.evaluate(() => window.__suggestionQueries)).toEqual(['old', 'new'])
      await expect(options).toHaveText(['new current suggestion'])
      await page.getByRole('button', { name: 'Use suggestion: new current suggestion', exact: true }).click()
      await expect(input).toHaveValue('new current suggestion')
    })
  })
}
