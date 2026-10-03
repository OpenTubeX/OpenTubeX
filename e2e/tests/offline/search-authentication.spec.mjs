import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, sel, setWindowSize } from '../../helpers/app.mjs'

const QUERY = 'age restricted search'
test.use({
  seed: {
    settings: {
      generalAutoLoadMorePaginatedItemsEnabled: false,
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue'
    }
  }
})
const ageGate = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{
            itemSectionRenderer: {
              contents: [{
                backgroundPromoRenderer: {
                  title: { simpleText: 'Confirm your age' },
                  bodyText: { simpleText: 'These results may be inappropriate for some users.' },
                  icon: { iconType: 'EMPTY_SEARCH' },
                  ctaButton: { buttonRenderer: { text: { simpleText: 'Sign in' }, navigationEndpoint: { signInEndpoint: {} } } }
                }
              }]
            }
          }]
        }
      }
    }
  }
}

async function searchForAgeGate(page) {
  const requests = []
  await page.route('https://www.youtube.com/youtubei/v1/search**', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: ageGate })
  })
  await page.locator(sel.searchInput).fill(QUERY)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByRole('heading', { name: 'Confirm your age' })).toBeVisible()
  await expect(page.getByText('These results may be inappropriate for some users.')).toBeVisible()
  await expect(page.getByText('Your search results have returned 0 results')).toHaveCount(0)
  return requests
}

async function configureCookieSearch(app, mode = 'file') {
  test.skip(process.platform === 'win32', 'The fixture executable uses a POSIX shebang')
  const executable = path.join(app.userDataDir, 'search-fixture.cjs')
  const log = path.join(app.userDataDir, 'search-args.json')
  const response = path.join(app.userDataDir, 'search-response.json')
  await writeFile(response, JSON.stringify({ entries: [] }))
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)))
setTimeout(() => process.stdout.write(fs.readFileSync(${JSON.stringify(response)}, 'utf8')), 300)
`)
  await chmod(executable, 0o755)
  await app.page.evaluate(async ({ executable, mode }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateYtDlpSource', 'system')
    await store.dispatch('updateYtDlpPath', executable)
    await store.dispatch('updateYtDlpPlaybackAuthMode', mode)
    await store.dispatch('updateYtDlpPlaybackCookiesPath', '/fixture/cookies.txt')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowser', 'firefox')
    await store.dispatch('updateYtDlpPlaybackCookiesBrowserProfile', '/fixture/profile')
  }, { executable, mode })
  return { log, response }
}

test('shows the age gate, cookie setup hint, and cached notice at desktop and phone widths', async ({ app, page }) => {
  await searchForAgeGate(page)
  await expect(page.getByText('Configure cookies in Settings → External Software → yt-dlp Cookies.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
  await page.locator(sel.searchInput).fill('different search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/different%20search/)
  await page.locator(sel.searchInput).fill(QUERY)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByRole('heading', { name: 'Confirm your age' })).toBeVisible()
  await setWindowSize(app, page, { width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Confirm your age' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const mode of ['file', 'browser']) {
  test(`retries through yt-dlp with ${mode} cookies and the original filters`, async ({ app, page }) => {
    const { log, response } = await configureCookieSearch(app, mode)
    await page.locator('.navFilterButton').click()
    await page.locator('.searchRadio', { hasText: 'Prioritize' }).getByText('Popularity', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    const requests = await searchForAgeGate(page)
    await expect(readFile(log)).rejects.toThrow()
    await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toBeVisible()
    if (mode === 'file') {
      for (const theme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: theme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
        const notice = page.locator('.searchNotice')
        const box = await notice.boundingBox()
        const width = Math.min(750, box.width)
        await page.screenshot({
          path: test.info().outputPath(`age-restricted-search-${theme}.png`),
          animations: 'disabled',
          clip: {
            x: box.x + (box.width - width) / 2, y: box.y - 12, width, height: box.height + 24
          }
        })
      }
    }
    await writeFile(response, JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Authenticated search result', channel: 'Creator', duration: 120 }] }))
    const retry = page.getByRole('button', { name: 'Try with configured cookies' })
    await retry.click()
    await expect(retry).toBeDisabled()
    await expect(page.getByText('Authenticated search result', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Confirm your age' })).toHaveCount(0)
    const args = JSON.parse(await readFile(log, 'utf8'))
    const cookieFlag = mode === 'file' ? '--cookies' : '--cookies-from-browser'
    expect(args[args.indexOf(cookieFlag) + 1]).toBe(mode === 'file' ? '/fixture/cookies.txt' : 'firefox:/fixture/profile')
    expect(args.indexOf(cookieFlag)).toBeLessThan(args.indexOf('--'))
    const url = new URL(args.at(-1))
    expect(url.searchParams.get('search_query')).toBe(QUERY)
    expect(url.searchParams.get('sp')).toBe(decodeURIComponent(requests[0].params))
    const cache = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getSessionSearchHistory)
    expect(cache.flatMap(entry => entry.data)).toEqual([])
  })
}

test('preserves the restriction and allows another retry when cookies return no results', async ({ app, page }) => {
  await configureCookieSearch(app)
  await searchForAgeGate(page)
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect(page.getByRole('alert')).toContainText('Search failed with the configured cookies.')
  await expect(page.getByRole('heading', { name: 'Confirm your age' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toBeEnabled()
  await expect(page.getByText('Your search results have returned 0 results')).toHaveCount(0)
})

test('does not offer an authenticated retry while family-friendly search is enabled', async ({ app, page }) => {
  await configureCookieSearch(app)
  await page.evaluate(async () => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateShowFamilyFriendlyOnly', true)
  })
  await searchForAgeGate(page)
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
})

for (const pendingRetry of [true, false]) {
  test(`discards ${pendingRetry ? 'pending' : 'loaded'} cookie results when family-friendly search is enabled`, async ({ app, page }) => {
    const { log, response } = await configureCookieSearch(app)
    await searchForAgeGate(page)
    await writeFile(response, JSON.stringify({
      entries: Array.from({ length: 20 }, (_, index) => ({
        id: String(index).padStart(11, '0'), title: `Restricted result ${index}`, channel: 'Creator', duration: 120
      }))
    }))
    await page.getByRole('button', { name: 'Try with configured cookies' }).click()
    if (pendingRetry) {
      await expect.poll(() => readFile(log, 'utf8').catch(() => '')).not.toBe('')
    } else {
      await expect(page.getByRole('heading', { name: 'Restricted result 0', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Fetch more results' })).toHaveCount(1)
    }
    await page.evaluate(async () => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateShowFamilyFriendlyOnly', true)
    })
    await page.waitForTimeout(500)
    await expect(page.getByRole('heading', { name: 'Confirm your age' })).toBeVisible()
    await expect(page.getByText('Restricted result', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Fetch more results' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
  })
}

test('paginates authenticated results and stops at an empty final page', async ({ app, page }) => {
  const { log, response } = await configureCookieSearch(app)
  await searchForAgeGate(page)
  await writeFile(response, JSON.stringify({
    entries: Array.from({ length: 20 }, (_, index) => ({
      id: String(index).padStart(11, '0'), title: `Authenticated video ${index}`, channel: 'Creator', duration: 120
    }))
  }))
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect(page.getByRole('heading', { name: 'Authenticated video 0', exact: true })).toBeVisible()
  await writeFile(response, JSON.stringify({ entries: [] }))
  await page.getByRole('button', { name: 'Fetch more results' }).click()
  await expect(page.getByText('There are no more results for this search')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Authenticated video 19', exact: true })).toBeVisible()
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  const args = JSON.parse(await readFile(log, 'utf8'))
  expect(args[args.indexOf('--playlist-start') + 1]).toBe('21')
})

test('keeps loaded results and retries the same page after a pagination error', async ({ app, page }) => {
  const { log, response } = await configureCookieSearch(app)
  await searchForAgeGate(page)
  await writeFile(response, JSON.stringify({
    entries: Array.from({ length: 20 }, (_, index) => ({
      id: String(index).padStart(11, '0'), title: `Authenticated video ${index}`, channel: 'Creator', duration: 120
    }))
  }))
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect(page.getByRole('heading', { name: 'Authenticated video 0', exact: true })).toBeVisible()
  await writeFile(response, 'invalid JSON')
  await page.getByRole('button', { name: 'Fetch more results' }).click()
  await expect(page.getByRole('alert')).toContainText('Search failed with the configured cookies.')
  await expect(page.getByText('There are no more results for this search')).toHaveCount(0)
  await writeFile(response, JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Recovered next page', channel: 'Creator', duration: 120 }] }))
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect(page.getByText('There are no more results for this search')).toBeVisible()
  await page.getByText('There are no more results for this search').scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { name: 'Recovered next page', exact: true })).toBeVisible()
  const args = JSON.parse(await readFile(log, 'utf8'))
  expect(args[args.indexOf('--playlist-start') + 1]).toBe('21')
})

test('ignores an authenticated retry that finishes after changing the search', async ({ app, page }) => {
  const { log, response } = await configureCookieSearch(app)
  await searchForAgeGate(page)
  await writeFile(response, JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Stale authenticated result' }] }))
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect.poll(() => readFile(log, 'utf8').catch(() => '')).not.toBe('')
  await page.locator(sel.searchInput).fill('new search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/new%20search/)
  await expect(page.getByRole('heading', { name: 'Confirm your age' })).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByText('Stale authenticated result', { exact: true })).toHaveCount(0)
})

test('ignores an authenticated retry after navigating to an oversized search', async ({ app, page }) => {
  const { log, response } = await configureCookieSearch(app)
  await searchForAgeGate(page)
  await writeFile(response, JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Stale authenticated result' }] }))
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect.poll(() => readFile(log, 'utf8').catch(() => '')).not.toBe('')
  const oversizedQuery = 'x'.repeat(101)
  await page.locator(sel.searchInput).fill(oversizedQuery)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`/search/${oversizedQuery}(\\?|$)`))
  await expect(page.getByRole('button', { name: oversizedQuery, exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByText('Stale authenticated result', { exact: true })).toHaveCount(0)
})
