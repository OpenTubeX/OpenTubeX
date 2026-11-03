import { test, expect } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      generalAutoLoadMorePaginatedItemsEnabled: true
    }
  }
})

test('stops showing the auto-load spinner when a hashtag has no more videos', async ({ page }) => {
  await page.route('**/api/v1/hashtag/**', async (route) => {
    await route.fulfill({ json: { results: [] } })
  })

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/hashtag/pagination-test',
    makeActive: false
  }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

  await expect(page).toHaveURL(/#\/hashtag\/pagination-test/)
  await expect(page.getByText('This hashtag does not currently have any videos')).toBeVisible()
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
})

test('does not offer to fetch more after the initial hashtag request fails', async ({ page }) => {
  await page.route('**/api/v1/hashtag/**', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'test failure' } })
  })
  const failedResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/hashtag/') && response.status() === 500
  )

  const hashtagTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/hashtag/request-failure',
    makeActive: false
  }))
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()

  await expect(page).toHaveURL(/#\/hashtag\/request-failure/)
  await failedResponse
  await expect(page.getByText('This hashtag does not currently have any videos')).toBeVisible()
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
})

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} hashtag
 */
async function openHashtag(page, hashtag) {
  const hashtagTab = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: false }), `/hashtag/${hashtag}`)
  await page.locator(`.tab[data-tab-id="${hashtagTab.id}"]`).click()
}

/**
 * @param {string} videoId
 * @param {string} title
 */
function hashtagVideo(videoId, title) {
  return { type: 'video', videoId, title, author: 'Channel', lengthSeconds: 60, videoThumbnails: [] }
}

test('falls back to Invidious with the requested hashtag', async ({ page }) => {
  await page.evaluate(() => Promise.all([
    window.$store.dispatch('updateBackendPreference', 'local'),
    window.$store.dispatch('updateBackendFallback', true)
  ]))
  await page.route('https://www.youtube.com/youtubei/v1/browse**', route => route.fulfill({ status: 500, json: {} }))
  const invidiousRequest = page.waitForRequest('**/api/v1/hashtag/**')
  await page.route('**/api/v1/hashtag/**', route => route.fulfill({ json: { results: [hashtagVideo('fallback001', 'Fallback video')] } }))

  await openHashtag(page, 'music')

  expect(new URL((await invidiousRequest).url()).pathname).toMatch(/\/api\/v1\/hashtag\/music$/)
  await expect(page.getByText('Fallback video')).toBeVisible()
})

test('ignores hashtag responses that arrive after another hashtag was opened', async ({ page }) => {
  /** @type {(value?: unknown) => void} */
  let releaseFirst
  const firstReleased = new Promise(resolve => { releaseFirst = resolve })
  const firstRequested = page.waitForRequest('**/api/v1/hashtag/first**')
  await page.route('**/api/v1/hashtag/first**', async (route) => {
    await firstReleased
    await route.fulfill({ json: { results: [hashtagVideo('firstvideo1', 'First video')] } })
  })
  await page.route('**/api/v1/hashtag/second**', route => route.fulfill({
    json: { results: new URL(route.request().url()).searchParams.get('page') === '1' ? [hashtagVideo('secondvide1', 'Second video')] : [] }
  }))

  await openHashtag(page, 'first')
  await firstRequested
  const searchBox = page.getByRole('searchbox', { name: 'Search / Go to URL' })
  await searchBox.fill('https://www.youtube.com/hashtag/second')
  await searchBox.press('Enter')
  await expect(page).toHaveURL(/#\/hashtag\/second/)
  await expect(page.getByText('Second video')).toBeVisible()

  const firstResponse = page.waitForResponse('**/api/v1/hashtag/first**')
  releaseFirst()
  await firstResponse
  // Let the renderer process the obsolete response before asserting its absence.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByText('First video')).toHaveCount(0)
  await expect(page.getByText('Second video')).toBeVisible()
})
