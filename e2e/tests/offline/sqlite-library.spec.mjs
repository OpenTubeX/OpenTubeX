import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, goTo, openNewWindowFromTabBar, waitForAppReady, updateInputWithoutScrolling } from '../../helpers/app.mjs'
import { DBActions } from '../../../src/constants.js'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const history = Array.from({ length: 350 }, (_, index) => ({
  _id: `history-${index}`,
  videoId: `v${String(index).padStart(10, '0')}`,
  title: `Library video ${index}`,
  author: 'Example channel',
  type: 'video',
  timeWatched: 1600000000000 + index,
  lengthSeconds: 300,
  watchProgress: 10,
  isWatched: false,
  unknownLegacyField: { index },
}))
const playlist = {
  _id: 'large',
  playlistName: 'Large legacy playlist',
  protected: true,
  createdAt: 1,
  lastUpdatedAt: 1,
  futureMetadata: { preserved: true },
  videos: Array.from({ length: 20000 }, (_, index) => ({
    videoId: `v${String(index % 350).padStart(10, '0')}`,
    playlistItemId: 'duplicate-legacy-id',
    title: `Playlist entry ${index}`,
    author: 'Example channel',
    type: 'video',
    timeAdded: index,
  })),
}

test.use({
  seed: {
    settings: { historyWatchedStatusMigrated: true, uiScale: 95, generalAutoLoadMorePaginatedItemsEnabled: false, userPlaylistSortOrder: 'custom', currentLocale: 'en_US', externalPlayerCustomArgs: '--play;--quit' },
    history,
    playlists: [playlist],
    watchStats: [{ _id: 'history-watch-time-v1' }],
  }
})

test('library worker rejects internal helpers and inherited targets while retaining authorized reads and writes', async ({ app }) => {
  const result = await app.electronApp.evaluate(async (_, workerPath) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads')
    const fs = process.getBuiltinModule('node:fs/promises')
    const { tmpdir } = process.getBuiltinModule('node:os')
    const { join } = process.getBuiltinModule('node:path')
    const directory = await fs.mkdtemp(join(tmpdir(), 'opentubex-worker-dispatch-'))
    const worker = new Worker(workerPath, { workerData: { directory } })
    let id = 0
    const request = (target, method, args = []) => new Promise((resolve, reject) => {
      worker.once('error', reject)
      worker.once('message', response => { worker.off('error', reject); resolve(response) })
      worker.postMessage({ id: ++id, target, method, args })
    })
    try {
      const denied = []
      denied.push(await request('engine', 'updateSubscriptionFeed', [{ channelId: 'hidden', entries: [{ videoId: 'hidden' }], timestamp: 1, field: 'videos' }]))
      denied.push(await request('engine', 'updateSubscriptionShortsMetadata', [{ channelId: 'hidden', entries: [] }]))
      denied.push(await request('handler:settings', 'toString'))
      denied.push(await request('handler:constructor', 'toString'))
      denied.push(await request('collection:constructor', 'findOneAsync', [{}]))
      denied.push(await request('collection:__proto__', 'countAsync', [{}]))
      const before = await request('collection:subscriptionCache', 'countAsync', [{}])
      const inserted = await request('collection:history', 'insertAsync', [{ _id: 'allowed', videoId: 'allowed', timeWatched: 1, unknown: { keep: true } }])
      const read = await request('collection:history', 'findOneAsync', [{ _id: 'allowed' }])
      const summary = await request('engine', 'historySummary', [{}])
      const setting = await request('handler:settings', 'upsert', ['workerDispatch', true])
      const storedSetting = await request('collection:settings', 'findOneAsync', [{ _id: 'workerDispatch' }])
      const feed = await request('handler:subscriptionCache', 'updateVideosByChannelId', ['allowed-channel', [{ videoId: 'feed-entry', title: 'Allowed entry' }], new Date(1)])
      const entries = await request('engine', 'subscriptionEntries', [{ channelId: 'allowed-channel', ids: ['feed-entry'] }])
      return { denied: denied.map(response => response.error?.message ?? 'unexpected success'), before, inserted, read, summary, setting, storedSetting, feed, entries }
    } finally {
      await worker.terminate()
      await fs.rm(directory, { recursive: true, force: true })
    }
  }, path.resolve('dist-e2e/libraryWorker.js'))
  expect(result.denied).toEqual([
    'Unknown library request', 'Unknown library request', 'Unknown library handler', 'Unknown library handler',
    'Unknown library collection', 'Unknown library collection',
  ])
  expect(result.before.result).toBe(0)
  expect(result.inserted.error).toBeUndefined()
  expect(result.read.result).toStrictEqual({ _id: 'allowed', videoId: 'allowed', timeWatched: 1, unknown: { keep: true } })
  expect(result.summary.error).toBeUndefined()
  expect(result.setting.error).toBeUndefined()
  expect(result.storedSetting.result).toStrictEqual({ _id: 'workerDispatch', value: true })
  expect(result.feed.result).toBe(true)
  expect(result.entries.result).toStrictEqual([{ videoId: 'feed-entry', title: 'Allowed entry', isNewInSubscriptionFeed: false }])
})

test('plays a bounded window of a large playlist using stable identity despite duplicate legacy item IDs', async ({ page }) => {
  await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
  const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 190, limit: 1 })).records[0])
  await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=large&playlistType=user&playlistItemId=${item.playlistItemId}&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
  const playerPlaylist = page.locator('.watchVideoPlaylist.resizablePlaylist')
  await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('191 / 20000')
  await expect(playerPlaylist.locator('.playlistItem')).toHaveCount(100)
  await playerPlaylist.getByText('Playlist entry 191', { exact: true }).click()
  await expect(playerPlaylist.locator('.playlistIndex label')).toHaveText('192 / 20000')
  expect((await residentState(page)).playlistRows).toBe(0)
})

async function residentState(page) {
  return page.evaluate(() => {
    const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state
    return {
      paged: state.history.libraryPaged,
      total: state.history.historyTotal,
      historyRows: state.history.historyCacheSorted.length,
      playlistRows: state.playlists.playlists.reduce((count, playlist) => count + playlist.videos.length, 0),
      largeCount: state.playlists.playlists.find(playlist => playlist._id === 'large')?.videoCount
    }
  })
}

for (const zoom of [0.95, 1.25]) {
  test(`keeps Watch playlist paging controls in view after content shrinks at ${zoom} scale`, async ({ page }) => {
    await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    const item = await page.evaluate(async () => (await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset: 19750, limit: 1 })).records[0])
    await page.evaluate(item => window.ftElectron.tabs.create({ route: `/watch/${item.videoId}?playlistId=large&playlistType=user&playlistItemId=${item.playlistItemId}&libraryMemberId=${item._libraryMemberId}`, makeActive: true }), item)
    const panel = page.locator('.watchVideoPlaylist.resizablePlaylist')
    const scroller = panel.locator('.playlistItemsWrapper')
    const more = scroller.getByRole('button', { name: 'Load More Videos', exact: true })
    const previous = scroller.getByRole('button', { name: 'Playing Previous Video', exact: true })
    const endState = button => button.evaluate(button => {
      const container = button.closest('.playlistItemsWrapper')
      const maximum = Math.max(0, container.scrollHeight - container.clientHeight)
      const scrollbar = container.querySelector('.os-scrollbar-vertical')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const handle = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
      const expectedOffset = maximum ? container.scrollTop / maximum * (track.height - handle.height) : 0
      const renderedMaximum = Math.max(0, button.getBoundingClientRect().bottom - container.getBoundingClientRect().top + container.scrollTop + Number.parseFloat(getComputedStyle(button).marginBottom) + Number.parseFloat(getComputedStyle(container).paddingBottom) - container.clientHeight)
      return {
        valid: container.scrollTop <= maximum + 2 / devicePixelRatio,
        noEmptyRange: Math.abs(maximum - renderedMaximum) * devicePixelRatio <= 2,
        atEnd: Math.abs(container.scrollTop - maximum) * devicePixelRatio <= 2,
        buttonInView: (button.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom) * devicePixelRatio <= 2,
        scrollbar: !scrollbar.classList.contains('os-scrollbar-unusable') && Math.abs(handle.top - track.top - expectedOffset) * devicePixelRatio <= 2,
      }
    })
    const expected = { valid: true, noEmptyRange: true, atEnd: true, buttonInView: true, scrollbar: true }
    const scrollToEnd = async button => {
      await expect.poll(async () => {
        await scroller.evaluate(element => { element.scrollTop = Number.MAX_SAFE_INTEGER })
        return endState(button)
      }).toEqual(expected)
    }
    await expect(panel.locator('.playlistItem')).toHaveCount(100)
    await scrollToEnd(more)
    await more.click()
    await expect(panel.locator('.playlistItem').first()).toContainText('Playlist entry 19830')
    await scrollToEnd(more)
    await more.click()
    await expect(panel.locator('.playlistItem')).toHaveCount(70)
    await expect.poll(async () => {
      const { valid, noEmptyRange, scrollbar } = await endState(previous)
      return { valid, noEmptyRange, scrollbar }
    }).toEqual({ valid: true, noEmptyRange: true, scrollbar: true })
    await scrollToEnd(previous)
    await scroller.evaluate(element => { element.style.height = '480px' })
    await expect.poll(() => scroller.evaluate(element => element.clientHeight)).toBe(480)
    await expect.poll(() => endState(previous)).toEqual(expected)
  })
}

async function expectDocumentScrollToMatchContent(page) {
  await expect.poll(() => page.evaluate(() => {
    const content = document.querySelector('.app > .routerView')
    const renderedRange = Math.max(0, content.getBoundingClientRect().bottom + window.scrollY + (Number.parseFloat(getComputedStyle(content).marginBottom) || 0) - window.innerHeight)
    const actualRange = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
    const track = scrollbar?.querySelector('.os-scrollbar-track')?.getBoundingClientRect()
    const handle = scrollbar?.querySelector('.os-scrollbar-handle')?.getBoundingClientRect()
    const expectedOffset = actualRange ? window.scrollY / actualRange * (track.height - handle.height) : 0
    return {
      valid: window.scrollY <= renderedRange + 2 / devicePixelRatio,
      noEmptyRange: Math.abs(actualRange - renderedRange) * devicePixelRatio <= 2,
      scrollbar: actualRange > 1
        ? !scrollbar?.classList.contains('os-scrollbar-unusable') && Math.abs(handle.top - track.top - expectedOffset) * devicePixelRatio <= 2
        : scrollbar?.classList.contains('os-scrollbar-unusable'),
    }
  })).toEqual({ valid: true, noEmptyRange: true, scrollbar: true })
}

test('reconciles synced unseen marks beyond the cached history page in both windows', async ({ app, page }) => {
  const second = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(second)
  const unseenAt = history[1].timeWatched + 1000
  await second.evaluate(async ({ records, action }) => {
    for (const record of records) await window.ftElectron.dbHistory(action, record)
  }, { records: [{ ...history[0], isWatched: true }, { ...history[1], isWatched: true, timeWatched: unseenAt + 1 }], action: DBActions.GENERAL.UPSERT })
  for (const window of [page, second]) {
    await window.evaluate(async ids => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('retainVideoState', ids)
      await store.dispatch('grabHistory')
      await store.dispatch('hydrateVideoState', ids)
    }, [history[0].videoId, history[1].videoId])
    expect(await window.evaluate(id => {
      const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history
      return { cached: state.historyCacheSorted.length, offPage: !state.historyCacheSorted.some(record => record.videoId === id), watched: state.historyCacheById[id].isWatched }
    }, history[0].videoId)).toEqual({ cached: 100, offPage: true, watched: true })
  }
  expect(await page.evaluate(async ({ ids, unseenAt }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('mergeSubscriptionSeenVideos', ids.map(videoId => ({ videoId, seenAt: unseenAt, unseenAt })))
    return store.dispatch('applySubscriptionUnseenHistory')
  }, { ids: [history[0].videoId, history[1].videoId], unseenAt })).toBe(1)
  for (const window of [page, second]) {
    await expect.poll(() => window.evaluate(ids => {
      const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history
      return ids.map(id => state.historyCacheById[id]?.isWatched)
    }, [history[0].videoId, history[1].videoId])).toEqual([false, true])
    expect((await residentState(window)).historyRows).toBe(100)
  }
  const records = await page.evaluate(async ids => (await window.ftElectron.libraryQuery('videoState', { ids })).history, [history[0].videoId, history[1].videoId])
  expect(records.find(record => record.videoId === history[0].videoId)).toStrictEqual(history[0])
  expect(records.find(record => record.videoId === history[1].videoId)).toStrictEqual({ ...history[1], isWatched: true, timeWatched: unseenAt + 1 })
})

test('migrates immutable originals, hydrates bounded views, and preserves concurrent writes during legacy imports', async ({ app, page }) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await goTo(page, 'history')
  await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(100)
  expect(await residentState(page)).toEqual({ paged: true, total: 350, historyRows: 100, playlistRows: 0, largeCount: 20000 })
  expect(await page.evaluate(() => {
    const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings
    return { locale: settings.currentLocale, arguments: settings.externalPlayerCustomArgs }
  })).toEqual({ locale: 'en-US', arguments: '["--play","--quit"]' })
  for (const [filename, records] of [['history', history], ['playlists', [playlist]]]) {
    expect(await readFile(path.join(app.userDataDir, `${filename}.db`), 'utf8')).toBe(records.map(record => JSON.stringify(record)).join('\n') + '\n')
  }

  const second = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(second)
  await goTo(second, 'history')
  expect((await residentState(second)).playlistRows).toBe(0)

  const job = await page.evaluate(async () => {
    const job = await window.ftElectron.libraryQuery('importStart', { format: 'records' })
    await window.ftElectron.libraryQuery('importChunk', {
      ...job,
      section: 'history',
      records: [{
        videoId: 'v0000000000', timeWatched: 1, watchProgress: 1, isWatched: false, importedUnknown: 'keep',
      }]
    })
    await window.ftElectron.libraryQuery('importChunk', {
      ...job,
      section: 'playlists',
      records: [{
        _id: 'large',
        playlistName: 'Large legacy playlist',
        protected: false,
        videos: [{ videoId: 'newimport01', playlistItemId: 'duplicate-legacy-id', title: 'Imported entry' }],
      }]
    })
    await window.ftElectron.libraryQuery('importFinish', job)
    return job
  })
  expect(await second.evaluate(async job => {
    try { await window.ftElectron.libraryQuery('importApply', { ...job, sections: ['history'] }); return 'unexpected' } catch (error) { return error.message }
  }, job)).toMatch(/window|owner|another/i)

  const concurrentHistory = { ...history[0], timeWatched: Date.now(), watchProgress: 120 }
  const concurrentPlaylist = await second.evaluate(async ({ action, record }) => {
    await window.ftElectron.dbHistory(action, record)
    await window.ftElectron.libraryQuery('addSelectedPlaylistVideos', {
      ids: ['large'], videos: [{ videoId: 'concurrent1', title: 'Concurrent entry' }], allowDuplicates: true,
    })
    return window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' })
  }, { action: DBActions.GENERAL.UPSERT, record: concurrentHistory })
  const expectedHistory = { ...concurrentHistory, importedUnknown: 'keep' }
  await page.evaluate(async job => {
    await window.ftElectron.libraryQuery('importApply', { ...job, sections: ['history', 'playlists'] })
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await Promise.all([store.dispatch('grabHistory'), store.dispatch('grabAllPlaylists')])
  }, job)

  for (const window of [page, second]) {
    await expect.poll(async () => (await residentState(window)).largeCount).toBe(20002)
    const [record] = await window.evaluate(async () => (await window.ftElectron.libraryQuery('videoState', { ids: ['v0000000000'] })).history)
    expect(record).toStrictEqual(expectedHistory)
  }
  const saved = await page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))
  const concurrentEntry = concurrentPlaylist.videos.at(-1)
  expect(concurrentEntry).toStrictEqual({
    videoId: 'concurrent1',
    title: 'Concurrent entry',
    type: 'video',
    playlistItemId: expect.any(String),
    timeAdded: expect.any(Number),
  })
  expect(saved.lastUpdatedAt).toBeGreaterThanOrEqual(concurrentPlaylist.lastUpdatedAt)
  expect(saved).toStrictEqual({
    ...playlist,
    lastUpdatedAt: saved.lastUpdatedAt,
    videos: [...playlist.videos, concurrentEntry, { videoId: 'newimport01', playlistItemId: 'duplicate-legacy-id', title: 'Imported entry' }],
  })

  await page.getByRole('searchbox', { name: 'Search in History' }).fill('Library video 0')
  await expect(page.locator('.historySearchLoader')).toHaveCount(0)
  await expect.poll(() => page.locator('.tabContent[aria-hidden="false"] .videoThumbnail img').evaluateAll(images => {
    const visible = images.filter(image => image.getBoundingClientRect().top < window.innerHeight)
    return visible.length > 0 && visible.every(image => image.complete && image.naturalWidth > 0)
  })).toBe(true)
  const reopened = await app.relaunch()
  await waitForAppReady(reopened.page)
  expect((await reopened.page.evaluate(async () => (await window.ftElectron.libraryQuery('videoState', { ids: ['v0000000000'] })).history))[0]).toStrictEqual(expectedHistory)
  expect(await reopened.page.evaluate(() => window.ftElectron.libraryQuery('playlistSnapshot', { id: 'large' }))).toStrictEqual(saved)
  for (const [filename, records] of [['history', history], ['playlists', [playlist]]]) {
    expect(await readFile(path.join(app.userDataDir, `${filename}.db`), 'utf8')).toBe(records.map(record => JSON.stringify(record)).join('\n') + '\n')
  }
})

test('playlist overview and add prompt use off-page metadata, summary artwork and duplicate counts', async ({ page }) => {
  await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('addPlaylist', { _id: 'empty', playlistName: 'Empty playlist', videos: [] })
  })
  await goTo(page, 'userplaylists')
  await page.getByText('Playlists with Matching Videos', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Playlists with Matching Videos' })).toBeChecked()
  await page.locator('.tabContent[aria-hidden="false"] .searchInputsRow input').fill('Playlist entry 19999')
  await expect(page.locator('.tabContent[aria-hidden="false"] .playlistList .ft-list-item')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Large legacy playlist', exact: true })).toBeVisible()
  await page.evaluate(async video => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [video] })
  }, history[0])
  const selector = page.getByRole('dialog').locator('.ft-playlist-selector').filter({ hasText: 'Large legacy playlist' })
  await expect(selector.locator('.videoCountContainer .inner > div').first()).toHaveText('20000')
  await expect(selector.locator('.videoPresenceCount')).toContainText('58')
  await expect.poll(() => selector.locator('.thumbnailImage').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
})

test.describe('age-based history cleanup with restored duplicates', () => {
  const retained = { ...history[0], _id: 'recent-copy', title: 'Recent restored history', timeWatched: Date.now(), unknownLegacyField: { keep: true } }
  test.use({ seed: { settings: { historyWatchedStatusMigrated: true, historyRetentionDays: 0 }, history: [history[0], retained] } })
  test('retains a recent occurrence and refreshes the shelf after deleting the older copy', async ({ page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await goTo(page, 'history')
    await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(2)
    const cards = page.locator('.tabContent[aria-hidden="false"] [data-feed-item-key]')
    const keys = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-feed-item-key')))
    expect(new Set(keys).size).toBe(2)
    const recentKey = await cards.filter({ hasText: retained.title }).getAttribute('data-feed-item-key')
    await page.getByRole('button', { name: 'Delete Old History', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(1)
    await expect(cards).toHaveAttribute('data-feed-item-key', recentKey)
    await expect(cards).toContainText(retained.title)
    const result = await page.evaluate(() => window.ftElectron.libraryQuery('historyPage'))
    expect(result.records).toStrictEqual([retained])
    expect(result.total).toBe(1)
    expect(result.cursor).toBeNull()
    await expect.poll(() => page.evaluate(() => {
      const state = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.history
      return { total: state.historyTotal, sorted: state.historyCacheSorted.map(record => record._id), cached: Object.values(state.historyCacheById).map(record => record._id) }
    })).toEqual({ total: 1, sorted: ['recent-copy'], cached: ['recent-copy'] })
  })
})

for (const scale of [95, 125]) {
  test(`clamps loaded History pages after responsive reflow at ${scale}% scale`, async ({ app, page }) => {
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.evaluate(async scale => {
      await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', scale)
    }, scale)
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
    await goTo(page, 'history')
    const content = page.locator('.tabContent[aria-hidden="false"] .historySearch').locator('xpath=..')
    const cards = content.locator('.autoGrid > *')
    await expect(cards).toHaveCount(100)
    for (const count of [200, 300]) {
      await content.getByRole('button', { name: 'Load More Videos' }).click()
      await expect(cards).toHaveCount(count)
    }
    await expect.poll(() => page.evaluate(() => {
      document.activeElement?.blur()
      window.scrollTo(0, Number.MAX_SAFE_INTEGER)
      return window.scrollY
    })).toBeGreaterThan(500)
    const before = await content.evaluate(element => element.getBoundingClientRect().height)
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100))
    await expect.poll(() => content.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(before)
    await expectDocumentScrollToMatchContent(page)
  })
}

for (const layout of ['grid', 'list']) {
  test.describe(`paged playlist ${layout} scroll range`, () => {
    test.use({
      seed: {
        settings: { uiScale: 95, playlistViewType: layout, userPlaylistSortOrder: 'custom', generalAutoLoadMorePaginatedItemsEnabled: false, alwaysShowScrollbars: true },
        playlists: [{ ...playlist, protected: false, videos: playlist.videos.slice(0, 350) }],
      }
    })
    for (const trigger of ['search', 'no-match search', 'sort', 'locale', 'removal', 'resize', 'layout']) {
      test(`clamps loaded pages after ${trigger} at fractional scale`, async ({ app, page }) => {
        await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
        await goTo(page, 'userplaylists')
        await page.getByRole('link', { name: 'Large legacy playlist', exact: true }).click()
        const content = page.locator('.tabContent[aria-hidden="false"] .playlistPage')
        const cards = content.locator('.autoGrid > *, .playlistItems > .playlistItem')
        await expect(cards).toHaveCount(100)
        for (const count of [200, 300]) {
          await content.getByRole('button', { name: 'Load More Videos' }).click()
          await expect(cards).toHaveCount(count)
        }
        await expect.poll(() => page.evaluate(() => {
          document.activeElement?.blur()
          window.scrollTo(0, Number.MAX_SAFE_INTEGER)
          return window.scrollY
        })).toBeGreaterThan(500)
        if (trigger.includes('search')) {
          await updateInputWithoutScrolling(content.locator('.searchInputsRow input'), trigger === 'search' ? 'Playlist entry 349' : 'no matching fixture')
          await expect(cards).toHaveCount(trigger === 'search' ? 1 : 0)
        } else if (trigger === 'resize') {
          await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100))
        } else if (trigger === 'removal') {
          await page.evaluate(async () => {
            const members = []
            for (const offset of [5, 255]) members.push(...(await window.ftElectron.libraryQuery('playlistWindow', { id: 'large', offset, limit: 250 })).records)
            await window.ftElectron.libraryQuery('removePlaylistMembers', { id: 'large', memberIds: members.map(video => video._libraryMemberId) })
            await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('grabAllPlaylists')
          })
          await expect(cards).toHaveCount(5)
        } else {
          await page.evaluate(async ({ trigger, layout }) => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            const actions = { sort: ['updateUserPlaylistSortOrder', 'video_title_ascending'], locale: ['updateCurrentLocale', 'de-DE'], layout: ['updatePlaylistViewType', layout === 'list' ? 'grid' : 'list'] }
            await store.dispatch(...actions[trigger])
          }, { trigger, layout })
          if (trigger !== 'layout') await expect(cards).toHaveCount(100)
        }
        await expectDocumentScrollToMatchContent(page)
      })
    }
  })
}
