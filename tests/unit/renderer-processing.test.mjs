import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { Worker } from 'node:worker_threads'
import { gunzipSync } from 'node:zlib'
import { reactive, toRaw } from 'vue'
import { createStore } from 'vuex'
import { migrateLegacyHistoryRecord } from '../../src/history.js'
import { Utils, YT } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'
import { executeBackgroundJob } from '../../src/renderer/helpers/background-job-operations.js'
import { BackgroundJobClient } from '../../src/renderer/helpers/background-job-client.js'
import { SyncServerDataLossError, SyncServerCancelledError } from '../../src/renderer/helpers/sync-server-errors.js'
import { parseSubscriptionRss } from '../../src/renderer/helpers/api/feed-rss.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const subscriptions = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
const historySource = await readFile(new URL('../../src/renderer/store/modules/history.js', import.meta.url), 'utf8')

function createJobs(onMessage = () => {}) {
  return new BackgroundJobClient(() => {
    const worker = new Worker(new URL('../helpers/renderer-processing-worker.mjs', import.meta.url))
    return {
      postMessage: value => { worker.postMessage(value); onMessage(value) },
      terminate: () => worker.terminate(),
      addEventListener: (type, listener) => worker.on(type, value => listener(type === 'message' ? { data: value } : value)),
    }
  })
}

function syncContext(runBackgroundJob) {
  const context = vm.createContext({ runBackgroundJob, toRaw })
  vm.runInContext(source
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)
  return context
}

function historyStore(DBHistoryHandlers) {
  const history = vm.compileFunction(historySource
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default ', 'return '), ['DBHistoryHandlers', 'migrateLegacyHistoryRecord'])(DBHistoryHandlers, migrateLegacyHistoryRecord)
  return createStore({ modules: { history } })
}

const historyRecord = (videoId, watchProgress = 15) => ({ videoId, authorId: 'UCtest', timeWatched: 1, watchProgress, lengthSeconds: 120 })
const remoteRecord = (videoId, watchProgress = 15) => ({
  video: { id: videoId, title: videoId, duration: 120, uploader: { id: 'UCtest', name: 'Channel' } },
  metadata: { added_date: 1, watched_state: 'watching', position_millis: watchProgress * 1000 },
})

function monitorInputDelay() {
  let previous = performance.now()
  let maximumDelay = 0
  let turns = 0
  const sample = () => {
    const now = performance.now()
    maximumDelay = Math.max(maximumDelay, now - previous)
    previous = now
  }
  const timer = setInterval(() => { sample(); turns++ }, 10)
  return {
    stop: () => clearInterval(timer),
    async finish() {
      // Include a synchronous pause at the beginning or end of the job, even
      // if its promise settles before the next interval can run.
      await new Promise(resolve => setTimeout(resolve, 0))
      sample()
      clearInterval(timer)
      assert.ok(turns > 0, 'Input must run while background work is pending')
      assert.ok(maximumDelay < 250, `Maximum renderer input delay was ${Math.round(maximumDelay)} ms`)
    },
  }
}

test('history edits during transfer cannot become remote deletions or lose new progress', async () => {
  const records = Array.from({ length: 600 }, (_, index) => ({
    videoId: `video-${index}`, authorId: 'UCtest', timeWatched: index + 1, watchProgress: 15,
  }))
  const remote = records.map(record => ({
    video: { id: record.videoId, uploader: { id: 'UCtest' } },
    metadata: { added_date: record.timeWatched, watched_state: 'watching', position_millis: 15_000 },
  }))
  const history = { historyCacheSorted: records, historyRevision: 0 }
  let edited = false
  const jobs = createJobs(message => {
    if (edited || message.type !== 'chunk' || message.path[0] !== 'localHistory') return
    edited = true
    // The first chunk has already been cloned. Simulate watching an unsent
    // video and updating progress on a record in that first chunk.
    const [watched] = records.splice(599, 1)
    records.unshift({ ...watched, timeWatched: 1000 })
    records[1].watchProgress = 99
    history.historyRevision++
  })
  const uploaded = []
  try {
    const snapshot = await syncContext((...args) => jobs.run(...args)).syncHistory({
      getWatchHistory: async () => remote,
      applyWatchHistoryChanges: async (entries, deleted) => {
        assert.deepEqual(deleted, [])
        uploaded.push(...entries)
      },
    }, { state: { history }, dispatch: () => assert.fail('Newer local history must not be overwritten') }, records.map(record => record.videoId))
    assert.equal(Object.keys(snapshot).length, 600)
    assert.equal(uploaded.find(entry => entry.video.id === 'video-0')?.metadata.position_millis, 99_000)
    assert.equal(uploaded.find(entry => entry.video.id === 'video-599')?.metadata.added_date, 1000)
  } finally { jobs.dispose() }
})

test('background cloning preserves Dates and undefined inside nested Vue proxies', async () => {
  const jobs = createJobs()
  const date = new Date('2026-10-09T10:00:00Z')
  const value = reactive({ records: [reactive({ date, optional: undefined })] })
  try {
    assert.deepEqual(await jobs.run('clone', { value }), { records: [{ date, optional: undefined }] })
  } finally { jobs.dispose() }
})

test('history edits during serialization prevent stale writes and retry with fresh state', async () => {
  const local = { videoId: 'video', authorId: 'UCtest', timeWatched: 1, watchProgress: 15, lengthSeconds: 120 }
  const remote = [{
    video: { id: 'video', title: 'Video', duration: 120, uploader: { id: 'UCtest', name: 'Channel' } },
    metadata: { added_date: 1, watched_state: 'watching', position_millis: 30_000 },
  }]
  let store
  let edited = false
  const jobs = createJobs(message => {
    if (edited || message.type !== 'chunk' || !message.path.includes('updates')) return
    edited = true
    store.commit('upsertToHistoryCache', { ...local, watchProgress: 99 })
  })
  const handlers = await readFile(new URL('../../src/datastores/handlers/electron.js', import.meta.url), 'utf8')
  const writes = []
  const context = vm.createContext({
    DBActions: { HISTORY: { APPLY_SYNC_CHANGES: 'sync' } },
    runBackgroundJob: (...args) => jobs.run(...args),
    window: { ftElectron: { dbHistory: (action, value) => writes.push(JSON.parse(value)) } },
  })
  vm.runInContext(handlers.replace(/^import .+\n/gm, '').replace(/export \{[\s\S]*?\}\n/g, '')
    .replace('export const recommendations', 'const recommendations') + '\nglobalThis.history = History', context)
  store = historyStore(context.history)
  store.commit('upsertToHistoryCache', local)
  const uploads = []
  let downloads = 0
  try {
    const snapshot = await syncContext((...args) => jobs.run(...args)).syncHistory({
      getWatchHistory: async () => { downloads++; return remote },
      applyWatchHistoryChanges: async entries => uploads.push(...entries),
    }, store)
    assert.equal(downloads, 2)
    assert.equal(writes.length, 0)
    assert.equal(store.state.history.historyCacheById.video.watchProgress, 99)
    assert.equal(snapshot.video.position_millis, 99_000)
    assert.equal(uploads[0].metadata.position_millis, 99_000)
  } finally { jobs.dispose() }
})

for (const backend of ['encrypted', 'legacy']) {
  for (const baseline of ['states', 'ids']) {
    test(`history re-added during ${backend} deletion survives retry with a ${baseline} baseline`, async () => {
      const jobs = createJobs()
      let remote = ['kept', 're-added', 'incoming'].map(id => remoteRecord(id))
      const previous = baseline === 'ids' ? ['kept', 're-added'] : {
        kept: remote[0].metadata, 're-added': remote[1].metadata,
      }
      const store = historyStore({ applySyncChanges: async (changes, assertActive) => assertActive?.() })
      store.commit('upsertToHistoryCache', historyRecord('kept'))
      let edited = false
      const apply = async (upserts, deletions) => {
        remote = remote.filter(entry => !deletions.includes(entry.video.id) && !upserts.some(update => update.video.id === entry.video.id)).concat(upserts)
        if (!edited && deletions.includes('re-added')) {
          edited = true
          // Re-watch while the acknowledged deletion is still awaiting return.
          store.commit('upsertToHistoryCache', { ...historyRecord('re-added'), timeWatched: 2, watchProgress: 99 })
        }
      }
      const client = {
        getWatchHistory: async () => remote,
        ...(backend === 'encrypted' ? { applyWatchHistoryChanges: apply } : {
          deleteWatchHistory: id => apply([], [id]),
          supportsBulkSync: async () => true,
          putWatchHistoryBulk: entries => apply(entries, []),
        }),
      }
      try {
        const snapshot = await syncContext((...args) => jobs.run(...args)).syncHistory(client, store, previous)
        assert.equal(store.state.history.historyCacheById['re-added']?.watchProgress, 99)
        assert.equal(remote.find(entry => entry.video.id === 're-added')?.metadata.position_millis, 99_000)
        assert.equal(snapshot['re-added']?.position_millis, 99_000)
        assert.ok(store.state.history.historyCacheById.incoming, 'An unapplied remote-only arrival must remain an insertion')
        assert.ok(remote.some(entry => entry.video.id === 'incoming'))
      } finally { jobs.dispose() }
    })
  }
}

for (const backend of ['encrypted', 'legacy bulk', 'legacy single']) {
  for (const edit of ['remove', 'rewind']) {
    test(`${edit} during ${backend} upload survives the next history attempt`, async () => {
      const jobs = createJobs()
      const store = historyStore({ applySyncChanges: async (changes, assertActive) => assertActive?.() })
      store.commit('upsertToHistoryCache', historyRecord('kept'))
      store.commit('upsertToHistoryCache', historyRecord('uploaded', 60))
      let remote = [remoteRecord('kept'), ...(edit === 'rewind' ? [remoteRecord('uploaded')] : [])]
      const previous = { kept: remote[0].metadata, ...(edit === 'rewind' ? { uploaded: remote[1].metadata } : {}) }
      let edited = false
      const apply = async (upserts, deletions) => {
        remote = remote.filter(entry => !deletions.includes(entry.video.id) && !upserts.some(update => update.video.id === entry.video.id)).concat(upserts)
        if (!edited && upserts.some(entry => entry.video.id === 'uploaded')) {
          edited = true
          if (edit === 'remove') store.commit('removeFromHistoryCacheById', 'uploaded')
          else store.commit('updateRecordWatchProgressInHistoryCache', { videoId: 'uploaded', watchProgress: 5 })
        }
      }
      const client = {
        getWatchHistory: async () => remote,
        ...(backend === 'encrypted' ? { applyWatchHistoryChanges: apply } : {
          deleteWatchHistory: id => apply([], [id]),
          supportsBulkSync: async () => backend === 'legacy bulk',
          putWatchHistoryBulk: entries => apply(entries, []),
          putWatchHistory: entry => apply([entry], []),
        }),
      }
      try {
        const snapshot = await syncContext((...args) => jobs.run(...args)).syncHistory(client, store, previous)
        if (edit === 'remove') {
          assert.equal(store.state.history.historyCacheById.uploaded, undefined)
          assert.equal(remote.some(entry => entry.video.id === 'uploaded'), false)
          assert.equal(snapshot.uploaded, undefined)
        } else {
          assert.equal(store.state.history.historyCacheById.uploaded.watchProgress, 5)
          assert.equal(remote.find(entry => entry.video.id === 'uploaded').metadata.position_millis, 5000)
          assert.equal(snapshot.uploaded.position_millis, 5000)
        }
      } finally { jobs.dispose() }
    })
  }
}

test('a rejected remote write is not retried just because history changed', async () => {
  const jobs = createJobs()
  const store = historyStore({ applySyncChanges: () => assert.fail('An uncertain write must stop before local changes') })
  store.commit('upsertToHistoryCache', historyRecord('video', 60))
  const failure = new Error('Request failed after sending')
  let downloads = 0
  try {
    await assert.rejects(syncContext((...args) => jobs.run(...args)).syncHistory({
      getWatchHistory: async () => { downloads++; return [remoteRecord('video')] },
      applyWatchHistoryChanges: async () => {
        store.commit('updateRecordWatchProgressInHistoryCache', { videoId: 'video', watchProgress: 5 })
        throw failure
      },
    }, store), error => error === failure)
    assert.equal(downloads, 1)
    assert.equal(store.state.history.historyCacheById.video.watchProgress, 5)
  } finally { jobs.dispose() }
})

test('a partial legacy write failure preserves the error and re-added local history', async () => {
  const jobs = createJobs()
  let applyingAllowed = false
  const store = historyStore({ applySyncChanges: async () => assert.ok(applyingAllowed) })
  let snapshot = JSON.stringify({ history: ['kept', 'first', 'second'], subscriptions: ['channel'] })
  store.persistHistorySyncBaseline = async changes => {
    snapshot = await jobs.run('updateHistorySnapshot', { snapshot, ...changes })
  }
  store.commit('upsertToHistoryCache', historyRecord('kept'))
  let remote = ['kept', 'first', 'second'].map(id => remoteRecord(id))
  const failure = new Error('Second deletion failed')
  let downloads = 0
  try {
    await assert.rejects(syncContext((...args) => jobs.run(...args)).syncHistory({
      getWatchHistory: async () => { downloads++; return remote },
      deleteWatchHistory: async id => {
        if (id === 'second') throw failure
        remote = remote.filter(entry => entry.video.id !== id)
        store.commit('upsertToHistoryCache', historyRecord(id, 99))
      },
    }, store, ['kept', 'first', 'second']), error => error === failure)
    assert.equal(downloads, 1)
    assert.equal(store.state.history.historyCacheById.first.watchProgress, 99)
    assert.deepEqual(JSON.parse(snapshot), { history: { kept: null, second: null }, subscriptions: ['channel'] })
    applyingAllowed = true
    await syncContext((...args) => jobs.run(...args)).syncHistory({
      getWatchHistory: async () => remote,
      deleteWatchHistory: async id => { remote = remote.filter(entry => entry.video.id !== id) },
      supportsBulkSync: async () => true,
      putWatchHistoryBulk: async entries => { remote.push(...entries) },
    }, store, JSON.parse(snapshot).history)
    assert.equal(store.state.history.historyCacheById.first.watchProgress, 99)
    assert.equal(remote.find(entry => entry.video.id === 'first').metadata.position_millis, 99_000)
  } finally { jobs.dispose() }
})

test('a stale data-loss error is retried, while continuous history edits stop after bounded retries', async () => {
  const history = { historyCacheSorted: [], historyRevision: 0 }
  let attempts = 0
  const context = syncContext(async (operation, input) => {
    if (++attempts === 1) {
      history.historyRevision++
      throw new SyncServerDataLossError('history', 1, 1, [])
    }
    return executeBackgroundJob(operation, input)
  })
  const client = { getWatchHistory: async () => [], supportsBulkSync: async () => true }
  const store = { state: { history } }
  assert.deepEqual(structuredClone(await context.syncHistory(client, store)), {})
  assert.equal(attempts, 2)
  attempts = 0
  const busy = syncContext(async (operation, input) => {
    attempts++
    history.historyRevision++
    return executeBackgroundJob(operation, input)
  })
  await assert.rejects(busy.syncHistory(client, store), /Watch history changed during sync/)
  assert.equal(attempts, 3)
})

test('playlist metadata changes invalidate sync snapshots without evicting the shelf cache', () => {
  const store = historyStore({})
  store.commit('upsertToHistoryCache', { videoId: 'video' })
  const revision = store.state.history.historyRevision
  const shelfRevision = store.state.history.continueWatchingRevision
  store.commit('updateRecordLastViewedPlaylistIdInHistoryCache', { videoId: 'video', lastViewedPlaylistId: 'playlist' })
  assert.equal(store.state.history.historyRevision, revision + 1)
  assert.equal(store.state.history.continueWatchingRevision, shelfRevision)
})

test('foreground feeds fall back to local parsing if the utility process fails', async () => {
  const local = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
  const bytes = await readFile(new URL('../../e2e/fixtures/innertube/channel/shows-channel-info-and-videos/browse-43cf009333cb.0.json.gz', import.meta.url))
  const data = JSON.parse(gunzipSync(bytes))
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: true } }, console: { error() {}, warn() {} },
    window: { ftElectron: { subscriptionAutoRefresh: { processFeed: async () => { throw new Error('Process exited') } } } },
    createInnertube: async () => ({ actions: { execute: async () => ({ data }) } }),
    store: { getters: {} }, shouldHideMembersOnlyContent: () => true,
    runBackgroundJob: executeBackgroundJob,
    YT, Utils, ...createLocalFeedParsers(() => false),
  })
  const start = local.indexOf('async function processForegroundSubscriptionResponse(')
  const end = local.indexOf('/**\n * @param {YT.Channel} channel', start)
  vm.runInContext(local.slice(start, end).replace(/^export /gm, ''), context)
  const result = await context.getLocalChannelVideos('UCtest')
  assert.equal(result.name, 'Blender')
  assert.equal(result.videos.length, 30)
  assert.deepEqual(structuredClone(await context.getLocalChannelLiveStreams('UCtest')), { name: result.name, thumbnailUrl: result.thumbnailUrl, videos: [] })
  assert.equal((await context.getLocalChannelCommunity('UCtest')).length, 0)
  Object.assign(context, { parseSubscriptionRss, enrichSubscriptionRssEntries: async entries => entries })
  const rssStart = subscriptions.indexOf('export async function parseYouTubeRSSFeed(')
  const rssEnd = subscriptions.indexOf('\n/**', rssStart)
  vm.runInContext(subscriptions.slice(rssStart, rssEnd).replace('export ', ''), context)
  const rss = '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><author><name>Channel</name></author><entry><yt:videoId>video</yt:videoId><title>Video</title><published>2026-10-09T10:00:00Z</published></entry></feed>'
  assert.equal((await context.parseYouTubeRSSFeed(rss, 'UCtest')).videos.length, 1)
})

test('large history sync lets renderer input run before merging finishes', async () => {
  const jobs = createJobs()
  const context = syncContext((...args) => jobs.run(...args))
  const records = Array.from({ length: 50_000 }, (_, index) => ({
    videoId: `video-${index}`, title: `Video ${index}`, authorId: 'UCtest', author: 'Channel',
    lengthSeconds: 120, timeWatched: index + 1, watchProgress: 15, isWatched: false,
  }))
  const remote = records.map(record => ({
    video: { id: record.videoId, title: record.title, duration: 120, uploader: { id: 'UCtest', name: 'Channel' } },
    metadata: { added_date: record.timeWatched, watched_state: 'watching', position_millis: 15_000 },
  }))
  const input = monitorInputDelay()
  try {
    const snapshot = await context.syncHistory({ getWatchHistory: async () => remote, supportsBulkSync: async () => true }, {
      state: { history: { historyCacheSorted: reactive(records) } }, dispatch: () => assert.fail('Unchanged history must not be written'),
    })
    assert.equal(Object.keys(snapshot).length, records.length)
    await input.finish()
  } finally {
    input.stop()
    jobs.dispose()
  }
})

test('foreground RSS parsing lets renderer input run before returning entries', async () => {
  const start = subscriptions.indexOf('export async function parseYouTubeRSSFeed(')
  const end = subscriptions.indexOf('\n/**', start)
  const jobs = createJobs()
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: true } },
    window: { ftElectron: { subscriptionAutoRefresh: { processFeed: input => jobs.run('subscriptionFeed', input) } } },
    parseSubscriptionRss, enrichSubscriptionRssEntries: async entries => entries,
  })
  vm.runInContext(subscriptions.slice(start, end).replace('export ', ''), context)
  const text = '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><author><name>Channel</name></author>' +
    Array.from({ length: 2000 }, (_, index) => `<entry><yt:videoId>video-${index}</yt:videoId><title>Video ${index}</title><published>2026-10-09T10:00:00Z</published></entry>`).join('') + '</feed>'
  const input = monitorInputDelay()
  try {
    const result = await context.parseYouTubeRSSFeed(text, 'UCtest')
    assert.equal(result.videos.length, 2000)
    await input.finish()
  } finally {
    input.stop()
    jobs.dispose()
  }
})

test('background merge preserves data-loss errors and permits an explicit retry', async () => {
  const jobs = createJobs()
  try {
    const input = {
      localHistory: [{ videoId: 'test', title: 'A video', authorId: 'UCtest', timeWatched: 100 }],
      remoteHistory: [], previous: ['test'],
    }
    await assert.rejects(jobs.run('mergeHistory', input), error => {
      assert.ok(error instanceof SyncServerDataLossError)
      assert.equal(error.collection, 'history')
      assert.deepEqual(error.items, [{ id: 'test', name: 'A video' }])
      return true
    })
    assert.deepEqual((await jobs.run('mergeHistory', { ...input, options: { allowDataLoss: true } })).deletions, ['test'])
  } finally { jobs.dispose() }
})

test('background encrypted collections and concurrent jobs retain their data', async () => {
  const jobs = createJobs()
  const data = Array.from({ length: 5000 }, (_, index) => ({ id: `record-${index}`, title: `Title ${index}` }))
  const exportedKey = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  try {
    const [payload, unchanged, changed] = await Promise.all([
      jobs.run('encryptSyncDocument', { data, exportedKey, salt }),
      jobs.run('equal', { first: data, second: data }),
      jobs.run('equal', { first: data, second: [] }),
    ])
    assert.equal(unchanged, true)
    assert.equal(changed, false)
    assert.deepEqual(await jobs.run('decryptSyncDocument', { payload, exportedKey }), data)
    const restored = await jobs.run('parse', { value: await jobs.run('stringify', { value: { history: data } }) })
    assert.deepEqual(restored, { history: data })
  } finally { jobs.dispose() }
})

test('foreground Local API parsing returns the recorded channel feed', async () => {
  const jobs = createJobs()
  try {
    const bytes = await readFile(new URL('../../e2e/fixtures/innertube/channel/shows-channel-info-and-videos/browse-43cf009333cb.0.json.gz', import.meta.url))
    const data = JSON.parse(gunzipSync(bytes))
    const result = await jobs.run('subscriptionFeed', { format: 'local', data: JSON.stringify(data), feedType: 'videos', channelId: 'UCtest' })
    assert.equal(result.name, 'Blender')
    assert.equal(result.videos.length, 30)
    assert.ok(result.videos.every(video => video.author === 'Blender' && typeof video.videoId === 'string'))
    assert.equal(result.channelId, result.videos[0].authorId)
    delete data.header
    const posts = await jobs.run('subscriptionFeed', { format: 'local', data: JSON.stringify(data), feedType: 'posts', channelId: 'UCtest' })
    assert.deepEqual(posts, { posts: [] })
  } finally { jobs.dispose() }
})

test('cancelling sync during background merging prevents local and remote writes', async () => {
  const jobs = createJobs()
  const context = syncContext((...args) => jobs.run(...args))
  let cancelled = false
  const timer = setTimeout(() => { cancelled = true }, 0)
  try {
    await assert.rejects(context.syncHistory({
      getWatchHistory: async () => [],
      applyWatchHistoryChanges: () => assert.fail('Cancelled sync must not upload'),
    }, {
      state: { history: { historyCacheSorted: [{ videoId: 'local', authorId: 'UCtest', timeWatched: 1 }] } },
      assertActive: () => { if (cancelled) throw new SyncServerCancelledError() },
      dispatch: () => assert.fail('Cancelled sync must not write'),
    }), SyncServerCancelledError)
  } finally {
    clearTimeout(timer)
    jobs.dispose()
  }
})

test('worker failure rejects outstanding jobs and the next job starts a fresh worker', async () => {
  const workers = []
  const jobs = new BackgroundJobClient(() => {
    const listeners = new Map()
    const worker = {
      terminated: false,
      terminate() { this.terminated = true },
      addEventListener: (type, listener) => listeners.set(type, listener),
      fail: () => listeners.get('error')(),
      postMessage(message) {
        if (message.type !== 'run') return
        queueMicrotask(() => {
          listeners.get('message')({ data: { type: 'value', id: message.id, path: [], value: true } })
          listeners.get('message')({ data: { type: 'done', id: message.id } })
        })
      },
    }
    workers.push(worker)
    return worker
  })
  try {
    const rejected = [0, 1].map(() => assert.rejects(jobs.run('clone', { value: [] }), /worker failed/))
    workers[0].fail()
    await Promise.all(rejected)
    assert.equal(workers[0].terminated, true)
    assert.equal(await jobs.run('clone', { value: [] }), true)
    assert.equal(workers.length, 2)
  } finally { jobs.dispose() }
})

test('large history database writes yield while removing renderer proxies', async () => {
  const jobs = createJobs()
  const handlers = await readFile(new URL('../../src/datastores/handlers/electron.js', import.meta.url), 'utf8')
  let written
  let inputHandled = false
  const context = vm.createContext({
    DBActions: { HISTORY: { APPLY_SYNC_CHANGES: 'sync' } },
    runBackgroundJob: (...args) => jobs.run(...args),
    window: { ftElectron: { dbHistory: (action, value) => {
      assert.equal(action, 'sync')
      assert.equal(inputHandled, true)
      assert.equal(typeof value, 'string')
      written = JSON.parse(value)
    } } },
  })
  vm.runInContext(handlers.replace(/^import .+\n/gm, '').replace(/export \{[\s\S]*?\}\n/g, '')
    .replace('export const recommendations', 'const recommendations') + '\nglobalThis.history = History', context)
  const changes = {
    insertions: [], deletions: [],
    updates: Array.from({ length: 20_000 }, (_, index) => new Proxy({ videoId: `video-${index}`, title: 'Video' }, {})),
  }
  const timer = setTimeout(() => { inputHandled = true }, 0)
  try {
    await context.history.applySyncChanges(changes)
    assert.deepEqual(written, changes)
    assert.doesNotThrow(() => structuredClone(written))
  } finally {
    clearTimeout(timer)
    jobs.dispose()
  }
})

test('cancelling sync during history serialization prevents the database write', async () => {
  const jobs = createJobs()
  const handlers = await readFile(new URL('../../src/datastores/handlers/electron.js', import.meta.url), 'utf8')
  let cancelled = false
  let written = false
  const context = vm.createContext({
    DBActions: { HISTORY: { APPLY_SYNC_CHANGES: 'sync' } },
    runBackgroundJob: (...args) => jobs.run(...args),
    window: { ftElectron: { dbHistory: () => { written = true } } },
  })
  vm.runInContext(handlers.replace(/^import .+\n/gm, '').replace(/export \{[\s\S]*?\}\n/g, '')
    .replace('export const recommendations', 'const recommendations') + '\nglobalThis.history = History', context)
  const changes = {
    insertions: [], deletions: [],
    updates: Array.from({ length: 20_000 }, (_, index) => ({ videoId: `video-${index}`, title: 'Video' })),
  }
  const timer = setTimeout(() => { cancelled = true }, 0)
  try {
    await assert.rejects(context.history.applySyncChanges(changes, () => {
      if (cancelled) throw new SyncServerCancelledError()
    }), SyncServerCancelledError)
    assert.equal(written, false)
  } finally {
    clearTimeout(timer)
    jobs.dispose()
  }
})
