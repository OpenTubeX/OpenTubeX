import { test, expect, goTo } from '../../helpers/app.mjs'

const size = 20000
const now = Date.now()
const videos = Array.from({ length: size }, (_, index) => ({
  _id: `v${String(index).padStart(10, '0')}`,
  videoId: `v${String(index).padStart(10, '0')}`,
  playlistItemId: `item-${index}`,
  title: `Practical troubleshooting techniques episode ${index}`,
  author: 'Example Channel',
  authorId: 'UC-performance-test',
  type: 'video',
  lengthSeconds: 120,
  watchProgress: 10,
  isWatched: false,
  timeWatched: now - index * 86_400_000,
  timeAdded: now,
}))

test.use({
  seed: {
    settings: {
      landingPage: 'trending',
      fetchSubscriptionsAutomatically: false,
      enableHomeRecommendations: false,
      uiScale: 95,
      historyWatchedStatusMigrated: true,
    },
    history: videos,
    playlists: [{
      _id: 'large-library',
      playlistName: 'Large library',
      description: '',
      createdAt: now,
      lastUpdatedAt: now,
      protected: false,
      videos,
    }],
  },
})

test('large-library search, metadata edits and bulk operations work with a throttled renderer', async ({ app, page }) => {
  test.setTimeout(120000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  try {
    await goTo(page, 'history')
    const search = page.getByRole('searchbox', { name: 'Search in History' })
    await search.fill('troubleshootnig')
    await expect(page.locator('.historySearchLoader')).toHaveCount(0)
    await expect(page.locator('.ft-list-video').first()).toBeVisible()
    await expect(page.getByText('Practical troubleshooting techniques episode 0', { exact: true })).toBeVisible()
    await search.fill('unrelatedzzzz')
    await expect(page.getByText('There are no videos in your history that match your search')).toBeVisible()

    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Large library', exact: true }).click()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__performancePlaylistVideos = store.getters.getPlaylist('large-library').videos
    })
    await page.getByTitle('Edit Playlist Info').click()
    await page.locator('.playlistStats input').fill('Renamed large library')
    await page.getByTitle('Save Changes').click()
    await expect(page.locator('.playlistTitle')).toHaveText('Renamed large library')
    expect(await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getPlaylist('large-library').videos === window.__performancePlaylistVideos
    })).toBe(true)

    // Exercise the renderer -> IPC -> NeDB paths, including history metadata
    // cleanup before playlist deletion and the incremental membership counts.
    await goTo(page, 'trending')
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const removed = store.getters.getPlaylist('large-library').videos.slice(0, 10000)
      await store.dispatch('removeVideos', {
        _id: 'large-library',
        playlistItemIds: removed.map(video => video.playlistItemId),
        videoIds: removed.map(video => video.videoId),
      })
      const records = store.getters.getHistoryCacheSorted.slice(0, 1000).map(record => ({ ...record, isWatched: true }))
      await store.dispatch('updateSubscriptionHistory', { records })
      await store.dispatch('removeHistoryOlderThan', 10000)
    })
    expect(await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return {
        playlistVideos: store.getters.getPlaylist('large-library').videos.length,
        savedVideos: store.getters.getPlaylistVideoCounts.size,
        history: store.getters.getHistoryCacheSorted.length,
        watched: store.getters.getHistoryCacheSorted.filter(record => record.isWatched).length,
      }
    })).toEqual({ playlistVideos: 10000, savedVideos: 10000, history: 10000, watched: 1000 })

    ;({ page } = await app.relaunch())
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return [store.getters.getPlaylist('large-library')?.videos.length, store.getters.getHistoryCacheSorted.length]
    })).toEqual([10000, 10000])
  } finally {
    await cdp.detach().catch(() => {})
  }
})
