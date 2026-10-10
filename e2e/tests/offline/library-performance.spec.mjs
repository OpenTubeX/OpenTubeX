import { test, expect, goTo } from '../../helpers/app.mjs'
import { DBActions } from '../../../src/constants.js'

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
    playlists: [{ _id: 'empty-library', playlistName: 'Empty library', videos: [] }, {
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

test('large-library search, metadata edits and bulk operations work with a throttled renderer', async ({ app, page }, testInfo) => {
  test.setTimeout(120000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  async function measure(label, action, completionBudgetMs) {
    await page.evaluate(() => {
      const timing = { started: performance.now(), previousTick: performance.now(), maxTimerGapMs: 0, ticks: 0 }
      timing.timer = setInterval(() => {
        const now = performance.now()
        timing.maxTimerGapMs = Math.max(timing.maxTimerGapMs, now - timing.previousTick)
        timing.previousTick = now
        timing.ticks++
      }, 16)
      window.largeLibraryTiming = timing
    })
    let metrics
    try {
      await action()
    } finally {
      metrics = await page.evaluate(async () => {
        const timing = window.largeLibraryTiming
        const elapsedMs = performance.now() - timing.started
        // Let the timer observe a stall in the final action or Vue update too.
        await new Promise(resolve => setTimeout(resolve, 32))
        clearInterval(timing.timer)
        delete window.largeLibraryTiming
        return { elapsedMs, maxTimerGapMs: timing.maxTimerGapMs, ticks: timing.ticks }
      })
      await testInfo.attach(label, { body: JSON.stringify(metrics), contentType: 'application/json' })
    }
    expect(metrics.ticks, JSON.stringify(metrics)).toBeGreaterThan(0)
    expect(metrics.maxTimerGapMs, JSON.stringify(metrics)).toBeLessThan(600)
    expect(metrics.elapsedMs, JSON.stringify(metrics)).toBeLessThan(completionBudgetMs)
  }
  try {
    await goTo(page, 'history')
    const search = page.getByRole('searchbox', { name: 'Search in History' })
    await measure('20k fuzzy history search', async () => {
      await search.fill('troubleshootnig')
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      await expect(page.locator('.ft-list-video').first()).toBeVisible()
      await expect(page.getByText('Practical troubleshooting techniques episode 0', { exact: true })).toBeVisible()
    }, 3000)
    await measure('20k no-match history search', async () => {
      await search.fill('unrelatedzzzz')
      await expect(page.getByText('There are no videos in your history that match your search')).toBeVisible()
    }, 3000)

    await goTo(page, 'userplaylists')
    await page.locator('label').filter({ hasText: 'Playlists with Matching Videos' }).click()
    await expect(page.getByRole('checkbox', { name: 'Playlists with Matching Videos' })).toBeChecked()
    const playlistSearch = page.locator('.searchInputsRow input')
    await measure('20k last-member playlist search', async () => {
      await playlistSearch.fill('Practical troubleshooting techniques episode 19999')
      await expect(page.locator('.playlistList .ft-list-item')).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'Large library', exact: true })).toBeVisible()
    }, 3000)
    await measure('20k no-match playlist search', async () => {
      await playlistSearch.fill('unrelatedzzzz')
      await expect(page.locator('.playlistList .ft-list-item')).toHaveCount(0)
    }, 3000)
    await playlistSearch.fill('')
    await page.getByRole('link', { name: 'Large library', exact: true }).click()
    await expect(page.locator('.ft-list-video').first()).toBeVisible()
    await page.getByTitle('Edit Playlist Info').click()
    await page.locator('.playlistStats input').fill('Renamed large library')
    await measure('20k playlist metadata edit', async () => {
      await page.getByTitle('Save Changes').click()
      await expect(page.locator('.playlistTitle')).toHaveText('Renamed large library')
    }, 3000)
    expect(await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const playlist = store.getters.getPlaylist('large-library')
      return playlist.videos.length === 0 && playlist.videoCount === 20000
    })).toBe(true)

    // Exercise the renderer -> IPC -> worker paths, including history metadata
    // cleanup before playlist deletion and the incremental membership counts.
    await goTo(page, 'trending')
    await measure('20k library bulk operations', () => page.evaluate(async ({ playlistItemIds, videoIds, records }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('removeVideos', {
        _id: 'large-library',
        playlistItemIds,
        videoIds,
      })
      await store.dispatch('updateSubscriptionHistory', { records })
      await store.dispatch('removeHistoryOlderThan', 10000)
    }, {
      playlistItemIds: videos.slice(0, 10000).map(video => video.playlistItemId),
      videoIds: videos.slice(0, 10000).map(video => video.videoId),
      records: videos.slice(0, 1000).map(record => ({ ...record, isWatched: true })),
    }), 10000)
    expect(await page.evaluate(async findAction => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const history = await window.ftElectron.dbHistory(findAction)
      return {
        playlistVideos: store.getters.getPlaylist('large-library').videoCount,
        residentPlaylistVideos: store.getters.getPlaylist('large-library').videos.length,
        history: history.length,
        watched: history.filter(record => record.isWatched).length,
      }
    }, DBActions.GENERAL.FIND)).toEqual({ playlistVideos: 10000, residentPlaylistVideos: 0, history: 10000, watched: 1000 })

    ;({ page } = await app.relaunch())
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return [store.getters.getPlaylist('large-library')?.videoCount, store.state.history.historyTotal]
    })).toEqual([10000, 10000])
  } finally {
    await cdp.detach().catch(() => {})
  }
})
