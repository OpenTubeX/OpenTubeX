import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      generalAutoLoadMorePaginatedItemsEnabled: true,
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue'
    }
  }
})

test('stops showing the auto-load spinner when search results are exhausted', async ({ page }) => {
  const searchSettings = {
    prioritize: 'relevance',
    time: '',
    type: 'all',
    duration: '',
    features: []
  }

  await page.evaluate((settings) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const result = {
      type: 'video',
      videoId: 'pagination-test',
      title: 'Pagination test result',
      author: 'OpenTubeX',
      authorId: 'pagination-test-author',
      lengthSeconds: 60,
      viewCount: 1,
      publishedText: 'Today',
      videoThumbnails: []
    }

    store.commit('addToSessionSearchHistory', {
      query: 'pagination test',
      data: [result],
      searchSettings: settings,
      nextPageRef: 'continuation',
      hasMoreResults: true,
      apiUsed: 'local'
    })
    store.commit('addToSessionSearchHistory', {
      query: 'pagination test',
      data: [result],
      searchSettings: settings,
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
  }, searchSettings)

  await page.locator(sel.searchInput).fill('pagination test')
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(/#\/search\/pagination%20test/)
  await expect(page.getByText('Pagination test result')).toBeVisible()
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  await expect(page.getByText('There are no more results for this search')).toBeVisible()
})

test('explains when a search returns no results', async ({ page }) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query: 'empty search',
      data: [],
      searchSettings: {
        prioritize: 'relevance',
        time: '',
        type: 'all',
        duration: '',
        features: []
      },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
  })

  await page.locator(sel.searchInput).fill('empty search')
  await page.locator(sel.searchInput).press('Enter')

  await expect(page).toHaveURL(/#\/search\/empty%20search/)
  await expect(page.getByText('Your search results have returned 0 results')).toBeVisible()
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
})

function searchVideo(id) {
  return {
    videoRenderer: {
      videoId: id,
      title: { simpleText: `Pagination result ${id}` },
      thumbnail: { thumbnails: [] },
      ownerText: { runs: [{ text: 'OpenTubeX', navigationEndpoint: { browseEndpoint: { browseId: 'pagination-test-author' } } }] },
      navigationEndpoint: { watchEndpoint: { videoId: id } },
      lengthText: { simpleText: '1:00' },
      viewCountText: { simpleText: '1 view' },
      publishedTimeText: { simpleText: '1 day ago' }
    }
  }
}

async function mockSearchPages(page, continuationResultCount = 1) {
  const requests = []
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://www.youtube.com/youtubei/v1/search**', async route => {
    const request = route.request().postDataJSON()
    requests.push(request)
    const index = requests.length
    const contents = [{
      itemSectionRenderer: {
        contents: index === 1
          ? [searchVideo('1')]
          : index === 2 ? Array.from({ length: continuationResultCount }, (_, i) => searchVideo(String(i + 2))) : []
      }
    }]
    if (index < 3) {
      contents.push({
        continuationItemRenderer: {
          trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
          continuationEndpoint: {
            commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/search' } },
            continuationCommand: { token: `page-${index + 1}`, request: 'CONTINUATION_REQUEST_TYPE_SEARCH' }
          }
        }
      })
    }
    const json = request.continuation
      ? { onResponseReceivedCommands: [{ reloadContinuationItemsCommand: { slot: 'RELOAD_CONTINUATION_SLOT_BODY', continuationItems: contents } }] }
      : {
          contents: {
            twoColumnSearchResultsRenderer: {
              primaryContents: { sectionListRenderer: { contents } }
            }
          }
        }
    await route.fulfill({ json })
  })
  return requests
}

for (const uiScale of [100, 95]) {
  test(`keeps loading short search pages until exhausted at ${uiScale}% UI scale`, async ({ page, attachScreenshot }) => {
    const colorScheme = uiScale === 100 ? 'dark' : 'light'
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
    await page.evaluate(async scale => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateUiScale', scale)
    }, uiScale)
    const requests = await mockSearchPages(page)
    await page.locator(sel.searchInput).fill('search pagination regression')
    await page.locator(sel.searchInput).press('Enter')

    await expect(page.getByText('Pagination result 2', { exact: true })).toBeVisible()
    await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
    await expect(page.getByText('There are no more results for this search')).toBeVisible()
    expect(requests.map(request => request.continuation ?? request.query)).toEqual([
      'search pagination regression', 'page-2', 'page-3'
    ])
    await expect(page.locator('.feed-enter-active')).toHaveCount(0)
    await attachScreenshot('completed search pagination')
  })
}

test('waits for scrolling when a search continuation fills the viewport', async ({ page }) => {
  const requests = await mockSearchPages(page, 30)
  await page.locator(sel.searchInput).fill('search pagination regression')
  await page.locator(sel.searchInput).press('Enter')

  await expect.poll(() => page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.getters.getSessionSearchHistory.find(search => search.query === 'search pagination regression')?.data.length
  })).toBe(31)
  const pagination = page.locator('.ft-auto-load-next-page-wrapper')
  await expect(pagination).not.toBeInViewport()
  // Let the replacement observer deliver its initial visibility notification.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(requests).toHaveLength(2)

  await pagination.scrollIntoViewIfNeeded()
  await expect(pagination).toHaveCount(0)
  await expect(page.getByText('There are no more results for this search')).toBeVisible()
  expect(requests).toHaveLength(3)
})

test('keeps pagination manual when automatic loading is disabled', async ({ page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateGeneralAutoLoadMorePaginatedItemsEnabled', false)
  })
  const requests = await mockSearchPages(page)
  await page.locator(sel.searchInput).fill('search pagination regression')
  await page.locator(sel.searchInput).press('Enter')

  const fetchMore = page.getByRole('button', { name: 'Fetch more results' })
  await expect(fetchMore).toBeVisible()
  expect(requests).toHaveLength(1)
  await fetchMore.focus()
  await fetchMore.press('Enter')
  await expect(page.getByText('Pagination result 2', { exact: true })).toBeVisible()
  await expect(fetchMore).toBeVisible()
  expect(requests).toHaveLength(2)

  await fetchMore.press('Enter')
  await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
  await expect(page.getByText('There are no more results for this search')).toBeVisible()
  expect(requests).toHaveLength(3)
})
