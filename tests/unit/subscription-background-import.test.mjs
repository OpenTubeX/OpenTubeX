import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
function section(start, end) {
  let offset = source.indexOf(start)
  if (source.slice(offset - 6, offset) === 'async ') offset -= 6
  return source.slice(offset, source.indexOf(end, offset))
}

test('concurrent background imports wait for the existing cache import', async () => {
  let finish
  const blocked = new Promise(resolve => { finish = resolve })
  const context = vm.createContext({
    console,
    getNextAndroidSubscriptionRefreshResult: async () => { await blocked; return null }
  })
  vm.runInContext(section('let reconcilingAndroidSubscriptionRefreshResults', 'async function reconcileAndroidSubscriptionRefreshChannelResult'), context)
  const first = context.reconcileAndroidSubscriptionRefreshResults()
  let secondFinished = false
  const second = context.reconcileAndroidSubscriptionRefreshResults().then(() => { secondFinished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(secondFinished, false)
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
  const cache = {}
  let saved
  const context = vm.createContext({
    console, Date,
    store: {
      getters: {
        getSubscribedChannelIdSet: new Set(['UCchannel']),
        getSubscribedChannelsById: new Map([['UCchannel', { id: 'UCchannel', name: 'Subscribed creator' }]])
      },
      dispatch: async (action, value) => { saved = value.videos; cache.UCchannel = value; return true }
    },
    getAndroidSubscriptionCacheConfig: () => ({ getCache: () => cache, entriesKey: 'videos', idKey: 'videoId', action: 'save' }),
    shouldHideMembersOnlyContent: () => false,
    enrichSubscriptionRssEntries: async entries => entries,
    reconcileFetchedSubscriptionEntries: entries => entries
  })
  vm.runInContext(section('async function reconcileAndroidSubscriptionRefreshChannelResult', 'function getAndroidSubscriptionCacheConfig'), context)
  await context.reconcileAndroidSubscriptionRefreshChannelResult({
    channelId: 'UCchannel', feedType: 'shorts', timestamp: Date.now(),
    payload: { backgroundFormat: 'entries', entries: [
      { videoId: 'missing', author: 'N/A', authorId: null },
      { videoId: 'absent' },
      { videoId: 'explicit', author: 'Explicit creator', authorId: 'UCexplicit' }
    ] }
  })
  assert.equal(saved[0].author, 'Subscribed creator')
  assert.equal(saved[0].authorId, 'UCchannel')
  assert.equal(saved[1].author, 'Subscribed creator')
  assert.equal(saved[1].authorId, 'UCchannel')
  assert.equal(saved[2].author, 'Explicit creator')
  assert.equal(saved[2].authorId, 'UCexplicit')
  assert.ok(saved.every(video => video.isShort))
})
