import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { subscriptionPage, updateSubscriptionFeed } from '../../src/datastores/sqlite/subscriptions.js'
import { reconcileFetchedSubscriptionEntries } from '../../src/renderer/helpers/subscription-entries.js'

const source = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
function section(start, end) {
  let offset = source.indexOf(start)
  if (source.slice(offset - 6, offset) === 'async ') offset -= 6
  return source.slice(offset, source.indexOf(end, offset))
}

test('concurrent background imports wait for the existing cache import', async () => {
  let finish
  let requests = 0
  const blocked = new Promise(resolve => { finish = resolve })
  const context = vm.createContext({
    console, isElectron: false,
    getNextAndroidSubscriptionRefreshResult: async () => { requests++; await blocked; return null }
  })
  vm.runInContext(section('let reconcilingAndroidSubscriptionRefreshResults', 'async function reconcileAndroidSubscriptionRefreshChannelResult'), context)
  const first = context.reconcileAndroidSubscriptionRefreshResults()
  let secondFinished = false
  const second = context.reconcileAndroidSubscriptionRefreshResults().then(() => { secondFinished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(secondFinished, false)
  assert.equal(requests, 1)
  finish()
  await Promise.all([first, second])
})

test('restoring an Electron window imports completed background results', async () => {
  const calls = []
  const context = vm.createContext({
    isElectron: true,
    isCapacitor: false,
    subscriptionCacheReady: { value: true },
    isAppHidden: () => false,
    synchronizeSubscriptionRefreshInProgress: () => {},
    reconcileAndroidSubscriptionRefreshResults: async () => { calls.push('import') },
    refreshOverdueSubscriptionFeeds: () => { calls.push('schedule') }
  })
  vm.runInContext(section('function handleSubscriptionAutoRefreshVisibilityChange', 'async function synchronizeSubscriptionRefreshInProgress'), context)
  await context.handleSubscriptionAutoRefreshVisibilityChange()
  assert.deepEqual(calls, ['import', 'schedule'])
})

test('an imported background completion prevents an unnecessary foreground refresh', async () => {
  const calls = []
  let deadline = 0
  const context = vm.createContext({
    console, process: { env: { IS_ELECTRON: true } }, navigator: { onLine: true },
    window: { ftElectron: { tabs: { isActive: async () => true } } },
    isElectron: true, isCapacitor: false,
    processingSubscriptionAutoRefreshes: false,
    pendingSubscriptionAutoRefreshes: [{ tab: 'videos', profileId: 'all', key: 'all:videos' }],
    pendingSubscriptionAutoRefreshKeys: new Set(['all:videos']),
    cancelledSubscriptionAutoRefreshKeys: new Set(),
    activeSubscriptionProfileId: { value: 'all' },
    isSubscriptionTabAutoRefreshEnabled: () => true,
    isAppHidden: () => false,
    getStoredSubscriptionTabNextAutoRefreshTimestamp: () => deadline,
    reconcileAndroidSubscriptionRefreshResults: async () => { deadline = Date.now() + 60000 },
    scheduleSubscriptionTabAutoRefresh: () => calls.push('schedule'),
    getSubscriptionTabRefreshHandler: () => async () => { calls.push('refresh'); return [] },
    t: value => value
  })
  vm.runInContext(section('async function processPendingSubscriptionAutoRefreshes', '/**\n * @param {\'videos\' | \'shorts\' | \'live\' | \'posts\'} tab\n * @param {string} profileId\n */\nfunction scheduleSubscriptionTabAutoRefreshLockRetry'), context)
  await context.processPendingSubscriptionAutoRefreshes()
  assert.deepEqual(calls, ['schedule'])
})

test('background playlist imports restore missing authors and keep explicit bylines', async () => {
  const cache = { UCchannel: { videos: [{ videoId: 'missing', thumbnailUrl: 'https://images.example/portrait.jpg' }] } }
  let saved
  let finishEnrichment
  const enrichment = new Promise(resolve => { finishEnrichment = resolve })
  const context = vm.createContext({
    console, Date,
    store: {
      state: { subscriptionCache: { libraryPaged: false } },
      getters: {
        getSubscribedChannelIdSet: new Set(['UCchannel']),
        getSubscribedChannelsById: new Map([['UCchannel', { id: 'UCchannel', name: 'Subscribed creator' }]])
      },
      dispatch: async (action, value) => { saved = value.videos; cache.UCchannel = value; return true }
    },
    getAndroidSubscriptionCacheConfig: () => ({ getCache: () => cache, entriesKey: 'videos', idKey: 'videoId', action: 'save' }),
    shouldHideMembersOnlyContent: () => false,
    enrichSubscriptionRssEntries: async entries => entries,
    enrichSubscriptionShortDates: async entries => { await enrichment; return entries.map(entry => ({ ...entry, published: 123456 })) },
    reconcileFetchedSubscriptionEntries: entries => entries
  })
  vm.runInContext(section('async function reconcileAndroidSubscriptionRefreshChannelResult', 'function getAndroidSubscriptionCacheConfig'), context)
  const pending = context.reconcileAndroidSubscriptionRefreshChannelResult({
    channelId: 'UCchannel', feedType: 'shorts', timestamp: Date.now(),
    payload: { backgroundFormat: 'entries', entries: [
      { videoId: 'missing', author: 'N/A', authorId: 'N/A', isRSS: true },
      { videoId: 'absent', author: '', authorId: '' },
      { videoId: 'explicit', author: 'Explicit creator', authorId: 'UCexplicit' }
    ] }
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved, undefined, 'background imports must wait for asynchronous Shorts enrichment before persisting')
  finishEnrichment()
  await pending
  assert.equal(saved[0].author, 'Subscribed creator')
  assert.equal(saved[0].authorId, 'UCchannel')
  assert.equal(saved[0].thumbnailUrl, 'https://images.example/portrait.jpg')
  assert.equal(saved[1].author, 'Subscribed creator')
  assert.equal(saved[1].authorId, 'UCchannel')
  assert.equal(saved[2].author, 'Explicit creator')
  assert.equal(saved[2].authorId, 'UCexplicit')
  assert.ok(saved.every(video => video.isShort))
  assert.ok(saved.every(video => video.published === 123456))
})

for (const feedType of ['videos', 'shorts', 'live', 'posts']) {
  test(`desktop background ${feedType} imports reconcile with durable entries instead of summary arrays`, async t => {
    const database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
    t.after(() => database.close())
    const engine = new LibraryEngine(database)
    const field = { videos: 'videos', shorts: 'shorts', live: 'liveStreams', posts: 'communityPosts' }[feedType]
    const entriesKey = feedType === 'posts' ? 'posts' : 'videos'
    const idKey = feedType === 'posts' ? 'postId' : 'videoId'
    const previousTimestamp = 10_000_000, timestamp = 20_000_000
    const old = { [idKey]: 'old', author: 'Creator', authorId: 'UCchannel', thumbnailUrl: 'old-image', attachments: [], published: 1, publishedTime: 1, isNewInSubscriptionFeed: false, unknown: new Date(1) }
    const incoming = [
      { [idKey]: 'new', author: 'Creator', authorId: 'UCchannel', thumbnailUrl: 'new-image', attachments: [], published: timestamp - 1, publishedTime: timestamp - 1 },
      { ...old, isNewInSubscriptionFeed: undefined },
    ]
    await engine.collections.subscriptionCache.insertAsync({ _id: 'UCchannel', [field]: [old], [field + 'Timestamp']: new Date(previousTimestamp) })
    const cache = { UCchannel: { [entriesKey]: [], timestamp: new Date(previousTimestamp) } }
    const context = vm.createContext({
      console, Date,
      store: {
        state: { subscriptionCache: { libraryPaged: true } },
        getters: { getSubscribedChannelIdSet: new Set(['UCchannel']), getSubscribedChannelsById: new Map(), getHistoryCacheById: {} },
        dispatch: async (action, data) => {
          assert.equal(action, 'save')
          const applied = await engine.transaction(() => updateSubscriptionFeed(engine, { channelId: data.channelId, field, entries: data[entriesKey], timestamp: data.timestamp }))
          cache.UCchannel = { [entriesKey]: [], timestamp: data.timestamp }
          return applied
        },
      },
      getAndroidSubscriptionCacheConfig: () => ({ getCache: () => cache, entriesKey, idKey, action: 'save' }),
      shouldHideMembersOnlyContent: () => false,
      enrichSubscriptionRssEntries: async entries => entries,
      enrichSubscriptionShortDates: async entries => entries,
      reconcileFetchedSubscriptionEntries,
    })
    vm.runInContext(section('async function reconcileAndroidSubscriptionRefreshChannelResult', 'function getAndroidSubscriptionCacheConfig'), context)
    await context.reconcileAndroidSubscriptionRefreshChannelResult({ channelId: 'UCchannel', feedType, timestamp, payload: { backgroundFormat: 'entries', entries: incoming } })
    const saved = await engine.collections.subscriptionCache.findOneAsync({ _id: 'UCchannel' })
    assert.deepEqual(saved[field], [{ ...incoming[0], isNewInSubscriptionFeed: true }, { ...incoming[1], isNewInSubscriptionFeed: false }])
    assert.deepEqual(saved[field + 'Timestamp'], new Date(timestamp))
    assert.deepEqual(incoming.map(entry => entry.isNewInSubscriptionFeed), [undefined, undefined])
    const page = await subscriptionPage(engine, { subscriptions: [{ id: 'UCchannel' }], category: feedType, onlyNew: true, enabledCategories: [feedType], preferences: { forbiddenTitles: [] }, now: timestamp })
    assert.deepEqual(page.records.map(entry => entry[idKey]), ['new'])
    assert.equal(page.hasNew, true)
  })
}


test('separate Electron renderers serialize background result imports', async () => {
  let finish
  let requests = 0
  const blocked = new Promise(resolve => { finish = resolve })
  let queue = Promise.resolve()
  const locks = { request(name, callback) {
    assert.equal(name, 'opentubex-background-subscription-import')
    const result = queue.then(callback)
    queue = result.catch(() => {})
    return result
  } }
  const contexts = [0, 1].map(() => {
    const context = vm.createContext({
      console, isElectron: true, navigator: { locks },
      getNextAndroidSubscriptionRefreshResult: async () => { requests++; await blocked; return null }
    })
    vm.runInContext(section('let reconcilingAndroidSubscriptionRefreshResults', 'async function reconcileAndroidSubscriptionRefreshChannelResult'), context)
    return context
  })
  const imports = contexts.map(context => context.reconcileAndroidSubscriptionRefreshResults())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests, 1, 'the second renderer must wait for the first import to finish')
  finish()
  await Promise.all(imports)
  assert.equal(requests, 2)
})
