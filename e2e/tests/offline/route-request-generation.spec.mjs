import { test, expect, sel } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: true,
      generalAutoLoadMorePaginatedItemsEnabled: false
    }
  }
})

function invidiousVideo(title, videoId) {
  return {
    type: 'video',
    title,
    videoId,
    author: 'OpenTubeX',
    authorId: 'UC-route-request-test',
    authorUrl: '/channel/UC-route-request-test',
    authorVerified: false,
    videoThumbnails: [],
    description: '',
    descriptionHtml: '',
    viewCount: 1,
    viewCountText: '1 view',
    lengthSeconds: 60,
    published: 1_700_000_000,
    publishedText: 'Today',
    premiereTimestamp: 0,
    liveNow: false,
    premium: false,
    isUpcoming: false,
    hasCaptions: false
  }
}

function localHashtagResponse(title, videoId) {
  return {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            selected: true,
            content: {
              richGridRenderer: {
                contents: [{
                  richItemRenderer: {
                    content: {
                      videoRenderer: {
                        videoId,
                        title: { simpleText: title },
                        thumbnail: { thumbnails: [] },
                        ownerText: {
                          runs: [{
                            text: 'OpenTubeX',
                            navigationEndpoint: {
                              browseEndpoint: { browseId: 'UC-local' }
                            }
                          }]
                        },
                        lengthText: { simpleText: '1:00' },
                        viewCountText: { simpleText: '1 view' },
                        publishedTimeText: { simpleText: '1 day ago' },
                        thumbnailOverlays: []
                      }
                    }
                  }
                }]
              }
            }
          }
        }]
      }
    }
  }
}

async function settleRenderer(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
}

const defaultSearchSettings = {
  prioritize: 'relevance',
  time: '',
  type: 'all',
  duration: '',
  features: []
}

async function cacheSearch(page, query, title) {
  await page.evaluate(({ query, result, searchSettings }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query,
      data: [result],
      searchSettings,
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
  }, {
    query,
    result: invidiousVideo(title, `${query.replaceAll(' ', '-')}-video`),
    searchSettings: defaultSearchSettings
  })
}

test('clears old search state before rejecting an overlong query', async ({ page }) => {
  await cacheSearch(page, 'cached search', 'cached search result')
  await cacheSearch(page, 'recovery search', 'recovery search result')

  await page.locator(sel.searchInput).fill('cached search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('cached search result')).toBeVisible()

  const rejectedQuery = 'x'.repeat(101)
  await page.locator(sel.searchInput).fill(rejectedQuery)
  await page.locator(sel.searchInput).press('Enter')

  await expect(page.getByText('cached search result')).toHaveCount(0)
  await expect(page.locator('[data-tab-loading-indicator]')).toHaveCount(0)
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  await expect(page.locator(sel.activeTab)).toContainText(rejectedQuery)

  await page.locator(sel.searchInput).fill('recovery search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('recovery search result')).toBeVisible()
})

test('settles the loader after an empty defensive search response', async ({ page }) => {
  await page.route('**/api/v1/search/**', async (route, request) => {
    const query = new URL(request.url()).searchParams.get('q')
    await route.fulfill({
      json: query === 'empty defensive response'
        ? false
        : [invidiousVideo(`${query} result`, `${query.replaceAll(' ', '-')}-video`)]
    })
  })

  await page.locator(sel.searchInput).fill('empty defensive response')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('Your search results have returned 0 results')).toBeVisible()
  await expect(page.locator('[data-tab-loading-indicator]')).toHaveCount(0)

  await page.locator(sel.searchInput).fill('recovery search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('recovery search result')).toBeVisible()
})

test('starts a Local API fallback at page one and replaces old results', async ({ page }) => {
  const invidiousRequests = []
  await page.route('**/api/v1/search/**', async (route, request) => {
    const url = new URL(request.url())
    const query = url.searchParams.get('q')
    const requestedPage = Number(url.searchParams.get('page'))
    invidiousRequests.push({ query, page: requestedPage })
    await route.fulfill({
      json: [invidiousVideo(`${query} page ${requestedPage}`, `${query}-${requestedPage}`)]
    })
  })
  await page.route('**/youtubei/v1/search**', route => route.abort())

  await page.locator(sel.searchInput).fill('old search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('old search page 1')).toBeVisible()

  await page.locator('.getNextPage').click()
  await expect(page.getByText('old search page 2')).toBeVisible()

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateBackendPreference', 'local')
  })
  await page.locator(sel.searchInput).fill('fallback search')
  await page.locator(sel.searchInput).press('Enter')

  await expect(page.getByText('fallback search page 1')).toBeVisible()
  await expect(page.getByText('old search page 1')).toHaveCount(0)
  await expect(page.getByText('old search page 2')).toHaveCount(0)
  expect(invidiousRequests.at(-1)).toEqual({ query: 'fallback search', page: 1 })
})

test('ignores a stale search response after the route changes', async ({ page }) => {
  let releaseFirstRequest
  let markFirstRequestStarted
  const firstRequestStarted = new Promise(resolve => { markFirstRequestStarted = resolve })

  await page.route('**/api/v1/search/**', async (route, request) => {
    const query = new URL(request.url()).searchParams.get('q')
    if (query === 'first search') {
      markFirstRequestStarted()
      await new Promise(resolve => { releaseFirstRequest = resolve })
    }

    await route.fulfill({
      json: [invidiousVideo(`${query} result`, `${query.replaceAll(' ', '-')}-video`)]
    })
  })

  await page.locator(sel.searchInput).fill('first search')
  await page.locator(sel.searchInput).press('Enter')
  await firstRequestStarted

  await page.locator(sel.searchInput).fill('second search')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('second search result')).toBeVisible()

  const firstResponseFinished = page.waitForResponse(response =>
    new URL(response.url()).searchParams.get('q') === 'first search'
  )
  releaseFirstRequest()
  await (await firstResponseFinished).finished()
  await settleRenderer(page)

  await expect(page.getByText('first search result')).toHaveCount(0)
  await expect(page.getByText('second search result')).toBeVisible()
  await expect(page.locator('[data-tab-loading-indicator]')).toHaveCount(0)
  await expect(page.locator(sel.searchInput)).toHaveValue('second search')
  expect(await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return {
      title: store.getters.getActiveTab.contentTitle,
      cache: store.getters.getSessionSearchHistory.map(entry => ({
        query: entry.query,
        titles: entry.data.map(result => result.title),
        searchPage: entry.searchPage,
        apiUsed: entry.apiUsed
      }))
    }
  })).toEqual({
    title: 'second search',
    cache: [{
      query: 'second search',
      titles: ['second search result'],
      searchPage: 2,
      apiUsed: 'invidious'
    }]
  })
})

test('keeps the newer search loader when a stale request fails', async ({ page }) => {
  let releaseFirstRequest
  let releaseSecondRequest
  let markFirstRequestStarted
  let markSecondRequestStarted
  let localFallbackRequests = 0
  const firstRequestStarted = new Promise(resolve => { markFirstRequestStarted = resolve })
  const secondRequestStarted = new Promise(resolve => { markSecondRequestStarted = resolve })

  await page.route('**/youtubei/v1/search**', route => {
    localFallbackRequests++
    return route.abort()
  })
  await page.route('**/api/v1/search/**', async (route, request) => {
    const query = new URL(request.url()).searchParams.get('q')
    if (query === 'stale failure') {
      markFirstRequestStarted()
      await new Promise(resolve => { releaseFirstRequest = resolve })
      await route.fulfill({ status: 500, json: { error: 'stale test failure' } })
      return
    }
    if (query === 'pending search') {
      markSecondRequestStarted()
      await new Promise(resolve => { releaseSecondRequest = resolve })
    }
    await route.fulfill({
      json: [invidiousVideo(`${query} result`, `${query.replaceAll(' ', '-')}-video`)]
    })
  })

  await page.locator(sel.searchInput).fill('stale failure')
  await page.locator(sel.searchInput).press('Enter')
  await firstRequestStarted

  await page.locator(sel.searchInput).fill('pending search')
  await page.locator(sel.searchInput).press('Enter')
  await secondRequestStarted

  const firstResponseFinished = page.waitForResponse(response =>
    new URL(response.url()).searchParams.get('q') === 'stale failure'
  )
  try {
    releaseFirstRequest()
    await (await firstResponseFinished).finished()
    await settleRenderer(page)

    await expect(page.locator('.fullscreen[data-tab-loading-indicator]')).toBeVisible()
    await expect(page.getByText('Falling back to Local API')).toHaveCount(0)
    expect(localFallbackRequests).toBe(0)
    expect(await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getActiveTab.contentTitle
    })).toBe('pending search')
  } finally {
    releaseSecondRequest?.()
  }

  await expect(page.getByText('pending search result')).toBeVisible()
  await expect(page.locator('[data-tab-loading-indicator]')).toHaveCount(0)
})

test('keeps the newer search pagination loader when an old page settles', async ({ page }) => {
  let releaseFirstPage
  let releaseSecondPage
  let markFirstPageStarted
  let markSecondPageStarted
  const firstPageStarted = new Promise(resolve => { markFirstPageStarted = resolve })
  const secondPageStarted = new Promise(resolve => { markSecondPageStarted = resolve })

  await page.route('**/api/v1/search/**', async (route, request) => {
    const url = new URL(request.url())
    const query = url.searchParams.get('q')
    const requestedPage = Number(url.searchParams.get('page'))
    if (query === 'first pages' && requestedPage === 2) {
      markFirstPageStarted()
      await new Promise(resolve => { releaseFirstPage = resolve })
    } else if (query === 'second pages' && requestedPage === 2) {
      markSecondPageStarted()
      await new Promise(resolve => { releaseSecondPage = resolve })
    }
    await route.fulfill({
      json: [invidiousVideo(`${query} page ${requestedPage}`, `${query}-${requestedPage}`)]
    })
  })

  await page.locator(sel.searchInput).fill('first pages')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('first pages page 1')).toBeVisible()
  await page.locator('.getNextPage').click()
  await firstPageStarted

  await page.locator(sel.searchInput).fill('second pages')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('second pages page 1')).toBeVisible()
  await page.locator('.getNextPage').click()
  await secondPageStarted
  await expect(page.getByLabel('Loading more')).toBeVisible()

  const firstResponseFinished = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.searchParams.get('q') === 'first pages' && url.searchParams.get('page') === '2'
  })
  try {
    releaseFirstPage()
    await (await firstResponseFinished).finished()
    await settleRenderer(page)

    await expect(page.getByLabel('Loading more')).toBeVisible()
    await expect(page.getByText('first pages page 2')).toHaveCount(0)
    await expect(page.getByText('second pages page 1')).toBeVisible()
  } finally {
    releaseSecondPage?.()
  }

  await expect(page.getByText('second pages page 2')).toBeVisible()
  await expect(page.getByLabel('Loading more')).toHaveCount(0)
})

test('ignores a stale hashtag response after the route changes', async ({ page }) => {
  let releaseFirstRequest
  let markFirstRequestStarted
  const firstRequestStarted = new Promise(resolve => { markFirstRequestStarted = resolve })

  await page.route('**/api/v1/hashtag/**', async (route, request) => {
    const hashtag = new URL(request.url()).pathname.split('/').filter(Boolean).at(-1)
    if (hashtag === 'first-tag') {
      markFirstRequestStarted()
      await new Promise(resolve => { releaseFirstRequest = resolve })
    }

    await route.fulfill({
      json: { results: [invidiousVideo(`${hashtag} result`, `${hashtag}-video`)] }
    })
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/first-tag')
  await page.locator(sel.searchInput).press('Enter')
  await firstRequestStarted

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/second-tag')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('second-tag result')).toBeVisible()

  const firstResponseFinished = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith('/first-tag')
  )
  releaseFirstRequest()
  await (await firstResponseFinished).finished()
  await settleRenderer(page)

  await expect(page.getByText('first-tag result')).toHaveCount(0)
  await expect(page.getByText('second-tag result')).toBeVisible()
  await expect(page.locator('[data-tab-loading-indicator]')).toHaveCount(0)
  expect(await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getActiveTab.contentTitle
  })).toBe('#second-tag')
})

test('ignores a stale Local API hashtag response after the route changes', async ({ page }) => {
  let releaseFirstRequest
  let markFirstRequestStarted
  let hashtagRequestCount = 0
  const firstRequestStarted = new Promise(resolve => { markFirstRequestStarted = resolve })

  await page.route('**/youtubei/v1/browse**', async (route, request) => {
    if (request.postDataJSON()?.browseId !== 'FEhashtag') {
      await route.abort()
      return
    }

    hashtagRequestCount++
    const isFirstRequest = hashtagRequestCount === 1
    if (isFirstRequest) {
      markFirstRequestStarted()
      await new Promise(resolve => { releaseFirstRequest = resolve })
    }

    await route.fulfill({
      json: localHashtagResponse(
        isFirstRequest ? 'first local result' : 'second local result',
        isFirstRequest ? 'first-local-video' : 'second-local-video'
      )
    })
  })
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateBackendPreference', 'local')
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/first-local')
  await page.locator(sel.searchInput).press('Enter')
  await firstRequestStarted

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/second-local')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('second local result')).toBeVisible()

  const firstResponseFinished = page.waitForResponse(response =>
    response.url().includes('/youtubei/v1/browse')
  )
  releaseFirstRequest()
  await (await firstResponseFinished).finished()
  await settleRenderer(page)

  await expect(page.getByText('first local result')).toHaveCount(0)
  await expect(page.getByText('second local result')).toBeVisible()
  await expect(page.locator('[data-tab-loading-indicator]')).toHaveCount(0)
  expect(await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getActiveTab.contentTitle
  })).toBe('#second-local')
})

test('keeps the newer hashtag pagination loader when an old page settles', async ({ page }) => {
  let releaseFirstPage
  let releaseSecondPage
  let markFirstPageStarted
  let markSecondPageStarted
  const firstPageStarted = new Promise(resolve => { markFirstPageStarted = resolve })
  const secondPageStarted = new Promise(resolve => { markSecondPageStarted = resolve })

  await page.route('**/api/v1/hashtag/**', async (route, request) => {
    const url = new URL(request.url())
    const hashtag = url.pathname.split('/').filter(Boolean).at(-1)
    const requestedPage = Number(url.searchParams.get('page'))
    if (hashtag === 'first-pages' && requestedPage === 2) {
      markFirstPageStarted()
      await new Promise(resolve => { releaseFirstPage = resolve })
    } else if (hashtag === 'second-pages' && requestedPage === 2) {
      markSecondPageStarted()
      await new Promise(resolve => { releaseSecondPage = resolve })
    }
    await route.fulfill({
      json: {
        results: [invidiousVideo(`${hashtag} page ${requestedPage}`, `${hashtag}-${requestedPage}`)]
      }
    })
  })

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/first-pages')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('first-pages page 1')).toBeVisible()
  await page.locator('.getNextPage').click()
  await firstPageStarted

  await page.locator(sel.searchInput).fill('https://www.youtube.com/hashtag/second-pages')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page.getByText('second-pages page 1')).toBeVisible()
  await page.locator('.getNextPage').click()
  await secondPageStarted
  await expect(page.getByLabel('Loading more')).toBeVisible()

  const firstResponseFinished = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/first-pages') && url.searchParams.get('page') === '2'
  })
  try {
    releaseFirstPage()
    await (await firstResponseFinished).finished()
    await settleRenderer(page)

    await expect(page.getByLabel('Loading more')).toBeVisible()
    await expect(page.getByText('first-pages page 2')).toHaveCount(0)
    await expect(page.getByText('second-pages page 1')).toBeVisible()
  } finally {
    releaseSecondPage?.()
  }

  await expect(page.getByText('second-pages page 2')).toBeVisible()
  await expect(page.getByLabel('Loading more')).toHaveCount(0)
})
