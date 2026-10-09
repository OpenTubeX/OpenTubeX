import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { test, expect, sel, setWindowSize } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

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
  await expect(page.locator('.searchHint')).toHaveCount(0)
  return requests
}

async function configureCookieSearch(app, mode = 'file', responseDelay = 300) {
  test.skip(process.platform === 'win32', 'The fixture executable uses a POSIX shebang')
  const executable = path.join(app.userDataDir, 'search-fixture.cjs')
  const log = path.join(app.userDataDir, 'search-args.json')
  const response = path.join(app.userDataDir, 'search-response.json')
  const playlistResponse = path.join(app.userDataDir, 'playlist-response.json')
  await writeFile(response, JSON.stringify({ entries: [] }))
  await writeFile(playlistResponse, JSON.stringify({}))
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)))
const response = process.argv.at(-1).includes('/playlist?') ? ${JSON.stringify(playlistResponse)} : ${JSON.stringify(response)}
setTimeout(() => process.stdout.write(fs.readFileSync(response, 'utf8')), ${responseDelay})
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
  return { log, response, playlistResponse }
}

async function captureSearchNotice(page, filename, animations = 'allow') {
  const box = await page.locator('.searchNotice').boundingBox()
  const width = Math.min(750, box.width)
  await page.screenshot({
    path: test.info().outputPath(filename),
    animations,
    clip: {
      x: box.x + (box.width - width) / 2, y: box.y - 12, width, height: box.height + 24
    }
  })
}

for (const responseType of ['empty', 'ads-only']) {
  test(`offers a cookie retry for ${responseType} search responses without an age notice`, async ({ app, page }) => {
    const { log, response } = await configureCookieSearch(app, 'file', 1000)
    const anonymousResponse = structuredClone(ageGate)
    anonymousResponse.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents =
      responseType === 'empty' ? [] : [{ searchPyvRenderer: { ads: [] } }, { adSlotRenderer: {} }]
    let searchRequest
    await page.route('https://www.youtube.com/youtubei/v1/search**', route => {
      searchRequest = route.request().postDataJSON()
      return route.fulfill({ json: anonymousResponse })
    })
    await page.locator(sel.searchInput).fill('opentubex')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByText('Your search results have returned 0 results')).toBeVisible()
    const restrictionHint = page.getByText('YouTube may have age-restricted this search query.', { exact: true })
    await expect(restrictionHint).toBeVisible()
    await expect(page.locator('.searchNotice')).toHaveCount(0)
    const retry = page.getByRole('button', { name: 'Try with configured cookies' })
    await expect(retry).toBeVisible()
    for (const theme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: theme })
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
      const messageBox = await page.locator('.searchStatus').boundingBox()
      const retryBox = await retry.boundingBox()
      expect(messageBox, 'The empty-search message must have visible bounds').not.toBeNull()
      expect(retryBox, 'The cookie retry button must have visible bounds').not.toBeNull()
      const width = Math.min(750, messageBox.width)
      await page.screenshot({
        path: test.info().outputPath(`empty-search-cookie-retry-${theme}.png`),
        animations: 'disabled',
        clip: { x: messageBox.x + (messageBox.width - width) / 2, y: messageBox.y - 16, width, height: retryBox.y + retryBox.height - messageBox.y + 32 }
      })
    }
    await page.locator(sel.searchInput).fill('another empty search')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/another%20empty%20search/)
    await page.locator(sel.searchInput).fill('opentubex')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/\/search\/opentubex/)
    await expect(retry).toBeVisible()
    await expect(restrictionHint).toBeVisible()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 125))
    await setWindowSize(app, page, { width: 390, height: 844 })
    await expect(retry).toBeVisible()
    await expect(restrictionHint).toBeVisible()
    await retry.click()
    await expect(retry).toBeDisabled()
    await expect(page.getByRole('status', { name: 'Fetching results. Please wait', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Search failed with the configured cookies.')
    await expect(retry).toBeEnabled()
    await writeFile(response, JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Recovered cookie search result' }] }))
    await retry.click()
    await expect(page.getByRole('heading', { name: 'Recovered cookie search result', exact: true })).toBeVisible()
    await expect(retry).toHaveCount(0)
    await expect(restrictionHint).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Fetching results. Please wait', exact: true })).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    const args = JSON.parse(await readFile(log, 'utf8'))
    const url = new URL(args.at(-1))
    expect(url.searchParams.get('search_query')).toBe('opentubex')
    expect(url.searchParams.get('sp')).toBe(decodeURIComponent(searchRequest.params))
    const cache = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getSessionSearchHistory)
    expect(cache.flatMap(entry => entry.data)).toEqual([])
  })
}

for (const invalidSearch of ['failed request', 'overlong query']) {
  test(`does not offer an age hint or cookie retry after ${invalidSearch}`, async ({ app, page }) => {
    await configureCookieSearch(app)
    const emptyResponse = structuredClone(ageGate)
    emptyResponse.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents = []
    await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ json: emptyResponse }))
    await page.locator(sel.searchInput).fill('successful empty search')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toBeVisible()
    const query = invalidSearch === 'overlong query' ? 'x'.repeat(101) : 'failed filtered search'
    await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ status: 503, json: { error: { message: 'Search unavailable' } } }))
    await page.locator('.navFilterButton').click()
    await page.locator('.searchRadio', { hasText: 'Type' }).getByText('Videos', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator(sel.searchInput).fill(query)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByText(invalidSearch === 'overlong query'
      ? 'Search query is over the 100 character limit'
      : 'Local API Error (Click to copy)')).toBeVisible()
    await expect(page.locator('.card')).toBeVisible()
    await expect(page.locator('.searchHint')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
  })
}

test('does not offer an empty-search cookie retry without cookies or with family-friendly search', async ({ app, page }) => {
  const emptyResponse = structuredClone(ageGate)
  emptyResponse.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents = []
  await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ json: emptyResponse }))
  await page.locator(sel.searchInput).fill('empty search without cookies')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('Your search results have returned 0 results')).toBeVisible()
  await expect(page.getByText('YouTube may have age-restricted this search query.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
  await configureCookieSearch(app)
  await page.evaluate(async () => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateShowFamilyFriendlyOnly', true)
  })
  await page.locator(sel.searchInput).fill('empty family-friendly search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('Your search results have returned 0 results')).toBeVisible()
  await expect(page.getByText('YouTube may have age-restricted this search query.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Try with configured cookies' })).toHaveCount(0)
})

test('cookie search loads video, playlist, and channel avatars and disposes empty Watch hosts', async ({ app, page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const { response } = await configureCookieSearch(app)
  const channelId = 'UCn_FAXem2-e3HQvmK-mOH4g'
  const avatar = 'https://yt3.ggpht.com/cookie-search-avatar'
  const thumbnail = 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg'
  const channelResponse = gunzipSync(await readFile(new URL('../../fixtures/innertube/channel/loads-the-glitch-channel-home-and-playlists-tabs/browse-4f0ffb6cfdfa.0.json.gz', import.meta.url)))
  let channelRequests = 0
  await page.route('**/youtubei/v1/browse*', route => {
    channelRequests++
    return route.fulfill({ contentType: 'application/json', body: channelResponse })
  })
  await page.route(/https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\//, route => fulfillVisualFixture(route, 'avatar'))
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await writeFile(response, JSON.stringify({
    entries: [
      { id: 'jNQXAC9IVRw', title: 'Cookie search video', channel: 'GLITCH', channel_id: channelId, duration: 120 },
      { id: 'PLcookieavatars', ie_key: 'YoutubeTab', title: 'Cookie search playlist', channel: 'GLITCH', channel_id: channelId, playlist_count: 2, thumbnails: [{ url: thumbnail }] },
      { id: channelId, title: 'Cookie search channel', thumbnails: [{ url: avatar }] }
    ]
  }))
  await searchForAgeGate(page)
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  const bylineAvatars = page.locator('.ft-list-item .channelAvatarImage')
  await expect(bylineAvatars).toHaveCount(2)
  await expectImagesLoaded(bylineAvatars)
  const channelAvatar = page.locator('.ft-list-channel img')
  await expect(channelAvatar).toHaveAttribute('src', avatar)
  await expectImagesLoaded(channelAvatar)
  expect(channelRequests).toBe(1)
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await page.locator('.ft-list-channel').screenshot({ path: test.info().outputPath(`cookie-search-channel-${theme}.png`), animations: 'disabled' })
  }
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 125))
  await setWindowSize(app, page, { width: 390, height: 844 })
  await expectImagesLoaded(channelAvatar)
  await setWindowSize(app, page, { width: 1600, height: 900 })
  await page.locator(sel.searchInput).fill('replacement search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByRole('heading', { name: 'Confirm your age' })).toBeVisible()
  await page.locator(sel.newTabButton).click()
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await page.locator(sel.tabs).last().getByRole('button', { name: 'Close Tab', exact: true }).click()
  await expect(page.locator(sel.tabs)).toHaveCount(1)
  expect(errors).toEqual([])
})

test('cookie channel avatars use YouTube URLs with the Invidious backend selected', async ({ app, page }) => {
  const { response } = await configureCookieSearch(app, 'browser')
  const avatar = 'https://yt3.googleusercontent.com/cookie-channel-avatar'
  await page.route(avatar, route => fulfillVisualFixture(route, 'avatar'))
  await writeFile(response, JSON.stringify({
    entries: [{
      id: 'UCn_FAXem2-e3HQvmK-mOH4g', title: 'Cookie search channel', thumbnails: [{ url: avatar }]
    }]
  }))
  await searchForAgeGate(page)
  // Keep the age-gate notice while changing the preferred backend: the cookie
  // retry still gets its data from yt-dlp, not from the selected instance.
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setBackendPreference', 'invidious')
    store.commit('setDefaultInvidiousInstance', 'https://invidious.test')
  })
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  const image = page.locator('.ft-list-channel img')
  await expect(image).toHaveAttribute('src', avatar)
  await expectImagesLoaded(image)
})

test('cookie search shows the playlist thumbnail and total count omitted by flat search', async ({ app, page }) => {
  const { log, response, playlistResponse } = await configureCookieSearch(app)
  const thumbnail = 'https://i.ytimg.com/vi/NIqqE7fdOPU/hq720.jpg'
  await page.route(thumbnail, route => route.fulfill({
    contentType: 'image/jpeg',
    path: new URL('../../fixtures/images/opentubex-playlist.jpg', import.meta.url).pathname
  }))
  await writeFile(response, JSON.stringify({
    entries: [{
      id: 'PLWgYtX0fBKnQ',
      ie_key: 'YoutubeTab',
      title: 'Instalar desde cero OpenTubeX | Guía de actualización automática para no perder las nuevas funciones de este año',
      channel: 'Vartrot Gassky',
      channel_id: 'UCiet5KCxObauWjx3-xjlJ4A',
      thumbnails: [{ url: thumbnail }]
    }]
  }))
  await writeFile(playlistResponse, JSON.stringify({ playlist_count: 10, entries: [{ id: 'NIqqE7fdOPU' }] }))
  await searchForAgeGate(page)
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  const card = page.locator('.ft-list-item', { hasText: 'Instalar desde cero OpenTubeX' })
  await expect(card).toBeVisible()
  await expect(card.locator('.videoCountContainer .inner')).toHaveText('10')
  const image = card.locator('.thumbnailImage')
  await expect(image).toHaveAttribute('src', thumbnail)
  await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  const args = JSON.parse(await readFile(log, 'utf8'))
  expect(args.at(-1)).toBe('https://www.youtube.com/playlist?list=PLWgYtX0fBKnQ')
  expect(args[args.indexOf('--playlist-start') + 1]).toBe('1')
  expect(args[args.indexOf('--playlist-end') + 1]).toBe('1')
  expect(args[args.indexOf('--cookies') + 1]).toBe('/fixture/cookies.txt')
  await card.screenshot({ path: test.info().outputPath('corrected-playlist.png') })
  await setWindowSize(app, page, { width: 390, height: 844 })
  await expect(card.locator('.videoCountContainer .inner')).toHaveText('10')
  await expect(image).toHaveAttribute('src', thumbnail)
})

test('stalled playlist metadata is bounded and its subprocesses are stopped', async ({ app, page }) => {
  const { response } = await configureCookieSearch(app)
  const executable = path.join(app.userDataDir, 'search-fixture.cjs')
  const pidsFile = path.join(app.userDataDir, 'playlist-pids.txt')
  const source = await readFile(executable, 'utf8')
  await writeFile(executable, source
    .replace("const fs = require('node:fs')", `const fs = require('node:fs')
if (process.argv.at(-1).includes('/playlist?')) fs.appendFileSync(${JSON.stringify(pidsFile)}, process.pid + ${JSON.stringify('\n')})`)
    .replace(', 300)', ", process.argv.at(-1).includes('/playlist?') ? 60000 : 300)"))
  await writeFile(response, JSON.stringify({
    entries: Array.from({ length: 20 }, (_, index) => ({
      id: `PLstalled${index}`, ie_key: 'YoutubeTab', title: `Stalled playlist ${index}`
    }))
  }))
  await searchForAgeGate(page)
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  const cards = page.locator('.ft-list-item', { hasText: 'Stalled playlist' })
  await expect(cards.first()).toBeVisible()
  await expect(cards.first().locator('.videoCountContainer .inner')).toHaveText('')
  await page.getByRole('button', { name: 'Fetch more results' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { name: 'Stalled playlist 19', exact: true })).toBeVisible()
  const pids = (await readFile(pidsFile, 'utf8')).trim().split('\n').map(Number)
  expect(pids).toHaveLength(2)
  await expect.poll(() => pids.filter(pid => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }).length).toBe(0)
})

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
    const { log, response } = await configureCookieSearch(app, mode, 3000)
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
        await captureSearchNotice(page, `age-restricted-search-${theme}.png`, 'disabled')
      }
    }
    await writeFile(response, JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Authenticated search result', channel: 'Creator', duration: 120 }] }))
    const retry = page.getByRole('button', { name: 'Try with configured cookies' })
    await retry.click()
    await expect(retry).toBeDisabled()
    await expect(page.locator('.searchNotice .spinner')).toBeVisible({ timeout: 1000 })
    await expect(page.getByText('Fetching results. Please wait')).toHaveCount(0)
    await expect(page.locator('.searchNotice [data-tab-loading-indicator]')).toBeVisible()
    const theme = mode === 'file' ? 'dark' : 'light'
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await captureSearchNotice(page, `age-restricted-search-loading-${theme}.png`)
    await expect(page.getByText('Authenticated search result', { exact: true })).toBeVisible()
    await expect(page.locator('.searchNotice .spinner')).toHaveCount(0)
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
  await expect(page.locator('.searchNotice .spinner')).toHaveCount(0)
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

test('clears prior results and loading after replacing a pending search with an oversized query', async ({ app, page }) => {
  const { response } = await configureCookieSearch(app)
  await searchForAgeGate(page)
  await writeFile(response, JSON.stringify({
    entries: Array.from({ length: 20 }, (_, index) => ({
      id: String(index).padStart(11, '0'), title: `Prior result ${index}`, channel: 'Creator', duration: 120
    }))
  }))
  await page.getByRole('button', { name: 'Try with configured cookies' }).click()
  await expect(page.getByRole('heading', { name: 'Prior result 0', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fetch more results' })).toHaveCount(1)
  let finishRequest
  let notifyRequestStarted
  const pendingResponse = new Promise(resolve => { finishRequest = resolve })
  const requestStarted = new Promise(resolve => { notifyRequestStarted = resolve })
  await page.route('https://www.youtube.com/youtubei/v1/search**', async route => {
    notifyRequestStarted()
    await pendingResponse
    await route.fulfill({ json: ageGate })
  })
  await page.locator(sel.searchInput).fill('pending local search')
  await page.locator(sel.searchInput).press('Enter')
  await requestStarted
  const oversizedQuery = 'x'.repeat(101)
  await page.locator(sel.searchInput).fill(oversizedQuery)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`/search/${oversizedQuery}(\\?|$)`))
  finishRequest()
  await page.waitForTimeout(500)
  await expect(page.getByRole('heading', { name: 'Search results', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Confirm your age' })).toHaveCount(0)
  await expect(page.getByText('Prior result', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Fetch more results' })).toHaveCount(0)
})
