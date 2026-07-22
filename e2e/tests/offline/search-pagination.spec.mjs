import { test, expect, sel } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      generalAutoLoadMorePaginatedItemsEnabled: true
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
