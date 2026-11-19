import { test, expect, sel } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

// Search suggestions would need the network
test.use({ seed: { settings: { enableSearchSuggestions: false } } })

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 */
async function search(page, query) {
  await page.locator(sel.searchInput).fill(query)
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(new RegExp(`#/search/${encodeURIComponent(query)}`))
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} videoId
 */
async function watch(page, videoId) {
  const video = await openMockedVideo(page, videoId)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(1)
  await video.evaluate(element => { element.currentTime = 10 })
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} videoId
 * @param {string} query
 */
function savedHistory(page, videoId, query) {
  return page.evaluate(({ videoId, query }) => ({
    watched: window.$store.getters.getHistoryCacheById[videoId] != null,
    searched: window.$store.getters.getSearchHistoryEntries.some(entry => (entry.query ?? entry._id) === query)
  }), { videoId, query })
}

test('incognito tabs save no watch or search history, unlike regular tabs', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.keyboard.press('Control+Shift+P')
  await expect(page.locator('.tab.active .incognitoIcon')).toBeVisible()
  await search(page, 'incognito query')
  await watch(page, 'aaaaaaaaaaa')
  // Closing the tab while the video plays saves nothing either
  await page.evaluate(() => window.$store.dispatch('closeActiveTab'))
  await expect(page.locator('.tab .incognitoIcon')).toHaveCount(0)
  expect(await page.evaluate(() => window.$store.getters.getClosedTabs.length)).toBe(0)

  await page.keyboard.press('Control+T')
  await search(page, 'regular query')
  await watch(page, 'bbbbbbbbbbb')
  // Once the regular tab's history is saved, the incognito tab's would have been too
  await expect.poll(() => savedHistory(page, 'bbbbbbbbbbb', 'regular query')).toEqual({ watched: true, searched: true })
  expect(await savedHistory(page, 'aaaaaaaaaaa', 'incognito query')).toEqual({ watched: false, searched: false })
})

test('finishing a playlist video in an incognito tab keeps it in a playlist that removes watched videos', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.keyboard.press('Control+Shift+P')
  await expect(page.locator('.tab.active .incognitoIcon')).toBeVisible()
  await openMockedVideo(page)
  const watchView = await watchViewHandle(page)
  await watchView.evaluate(async view => {
    await view.$store.dispatch('addPlaylist', {
      _id: 'ft-playlist--incognito-removal',
      playlistName: 'Incognito removal',
      removeWatchedVideos: true,
      videos: [
        { videoId: 'jNQXAC9IVRw', playlistItemId: 'first', title: 'First' },
        { videoId: 'dQw4w9WgXcQ', playlistItemId: 'second', title: 'Second' },
      ]
    })
    await view.$store.dispatch('updateUserPlaylistSortOrder', 'custom')
    await view.tabRouter.push({
      path: '/watch/jNQXAC9IVRw',
      query: { playlistId: 'ft-playlist--incognito-removal', playlistType: 'user', playlistItemId: 'first' }
    })
  })
  await expect.poll(() => watchView.evaluate(view => view.watchingPlaylist && !!view.$refs.watchVideoPlaylist)).toBe(true)
  const video = await waitForPlayback(page)
  await video.evaluate(element => { element.currentTime = element.duration - 1 })
  // A regular tab removes the video before the playlist moves on
  await expect(page).toHaveURL(/watch\/dQw4w9WgXcQ.*playlistItemId=second/)
  expect(await watchView.evaluate(view =>
    view.$store.getters.getPlaylist('ft-playlist--incognito-removal').videos.map(item => item.playlistItemId)))
    .toEqual(['first', 'second'])
})
