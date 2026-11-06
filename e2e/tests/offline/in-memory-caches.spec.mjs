import { test, expect } from '../../helpers/app.mjs'

test('keeps only the most recently loaded searches in memory', async ({ page }) => {
  const queries = await page.evaluate(() => {
    const store = window.$store
    const searchSettings = store.getters.getSearchSettings()
    for (let index = 0; index < 40; index++) {
      store.commit('addToSessionSearchHistory', {
        query: `search ${index}`,
        searchSettings,
        data: [{ videoId: `video${index}` }]
      })
    }
    // Loading more results for an older search makes it the most recent one.
    store.commit('addToSessionSearchHistory', {
      query: 'search 15',
      searchSettings,
      data: [{ videoId: 'video15' }, { videoId: 'video15b' }]
    })
    store.commit('addToSessionSearchHistory', { query: 'search 40', searchSettings, data: [] })
    return store.getters.getSessionSearchHistory.map(search => search.query)
  })

  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => `search ${from + index}`)
  expect(queries).toEqual([...range(11, 14), ...range(16, 39), 'search 15', 'search 40'])
})

test('drops tab caches when their tab closes', async ({ page }) => {
  const tabId = await page.evaluate(async () => {
    const { id } = await window.ftElectron.tabs.create({ route: '/history', makeActive: false })
    return id
  })
  await expect.poll(() => page.evaluate(id => window.$store.getters.getTabById(id) !== undefined, tabId)).toBe(true)
  await page.evaluate((id) => {
    const store = window.$store
    store.commit('setCachedPlaylist', { tabId: id, value: { items: [{ videoId: 'cachedVideo' }] } })
    store.commit('setSearchFilterValueChanged', { tabId: id, value: true })
  }, tabId)
  expect(await page.evaluate(id => window.$store.getters.getCachedPlaylist(id) !== null, tabId)).toBe(true)

  await page.evaluate(id => window.ftElectron.tabs.close(id), tabId)

  await expect.poll(() => page.evaluate(id => ({
    playlist: window.$store.getters.getCachedPlaylist(id),
    searchFilterChanged: Object.hasOwn(window.$store.state.utils.searchFilterValueChangedByTabId, id)
  }), tabId)).toEqual({ playlist: null, searchFilterChanged: false })
})
