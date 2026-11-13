import { test, expect } from '../../helpers/app.mjs'

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
