import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { Worker } from 'node:worker_threads'
import { gunzipSync } from 'node:zlib'
import { BackgroundJobClient } from '../../src/renderer/helpers/background-job-client.js'
import { SyncServerDataLossError, SyncServerCancelledError } from '../../src/renderer/helpers/sync-server-errors.js'
import { parseSubscriptionRss } from '../../src/renderer/helpers/api/feed-rss.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const subscriptions = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')

function createJobs() {
  return new BackgroundJobClient(() => {
    const worker = new Worker(new URL('../helpers/renderer-processing-worker.mjs', import.meta.url))
    return {
      postMessage: value => worker.postMessage(value),
      terminate: () => worker.terminate(),
      addEventListener: (type, listener) => worker.on(type, value => listener(type === 'message' ? { data: value } : value)),
    }
  })
}

test('large history sync lets renderer input run before merging finishes', async () => {
  const jobs = createJobs()
  const context = vm.createContext({ runBackgroundJob: (...args) => jobs.run(...args) })
  vm.runInContext(source
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)
  const records = Array.from({ length: 50_000 }, (_, index) => ({
    videoId: `video-${index}`, title: `Video ${index}`, authorId: 'UCtest', author: 'Channel',
    lengthSeconds: 120, timeWatched: index + 1, watchProgress: 15, isWatched: false,
  }))
  const remote = records.map(record => ({
    video: { id: record.videoId, title: record.title, duration: 120, uploader: { id: 'UCtest', name: 'Channel' } },
    metadata: { added_date: record.timeWatched, watched_state: 'watching', position_millis: 15_000 },
  }))
  let inputHandled = false
  const input = setTimeout(() => { inputHandled = true }, 0)
  const started = performance.now()
  try {
    const snapshot = await context.syncHistory({ getWatchHistory: async () => remote, supportsBulkSync: async () => true }, {
      state: { history: { historyCacheSorted: records } }, dispatch: () => assert.fail('Unchanged history must not be written'),
    })
    assert.equal(Object.keys(snapshot).length, records.length)
    assert.equal(inputHandled, true, `Renderer input was blocked throughout ${Math.round(performance.now() - started)} ms of merging`)
  } finally {
    clearTimeout(input)
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
  let inputHandled = false
  const input = setTimeout(() => { inputHandled = true }, 0)
  try {
    const result = await context.parseYouTubeRSSFeed(text, 'UCtest')
    assert.equal(result.videos.length, 2000)
    assert.equal(inputHandled, true, 'RSS parsing occupied the renderer until all entries were parsed')
  } finally {
    clearTimeout(input)
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
    const result = await jobs.run('subscriptionFeed', { format: 'local', data, feedType: 'videos', channelId: 'UCtest' })
    assert.equal(result.name, 'Blender')
    assert.equal(result.videos.length, 30)
    assert.ok(result.videos.every(video => video.author === 'Blender' && typeof video.videoId === 'string'))
    assert.equal(result.channelId, result.videos[0].authorId)
    delete data.header
    const posts = await jobs.run('subscriptionFeed', { format: 'local', data, feedType: 'posts', channelId: 'UCtest' })
    assert.deepEqual(posts, { posts: [] })
  } finally { jobs.dispose() }
})

test('cancelling sync during background merging prevents local and remote writes', async () => {
  const jobs = createJobs()
  const context = vm.createContext({ runBackgroundJob: (...args) => jobs.run(...args) })
  vm.runInContext(source
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
    .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)
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
