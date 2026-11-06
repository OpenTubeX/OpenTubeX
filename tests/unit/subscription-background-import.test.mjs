import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { createStore, deadlineKey, hooks, loadSubscriptionAutoRefresh, settle } from '../helpers/subscription-auto-refresh.mjs'

// Each platform reads its build flags when the module loads.
const android = await loadSubscriptionAutoRefresh({ IS_CAPACITOR: 'true' })
const electron = await loadSubscriptionAutoRefresh({ IS_ELECTRON: 'true' })

/**
 * Starts the composable for one platform, as App.vue does once it can handle
 * refresh events.
 * @param {import('node:test').TestContext} t
 * @param {typeof android} platform
 * @param {{ env: Record<string, string>, dataReady?: boolean }} options
 */
function start(t, platform, { env, dataReady = false }) {
  for (const name of ['IS_ELECTRON', 'IS_CAPACITOR']) {
    if (env[name]) process.env[name] = env[name]
    else delete process.env[name]
  }
  const autoRefresh = platform.useSubscriptionAutoRefresh({ dataReady: ref(dataReady), t: key => key })
  autoRefresh.start()
  t.after(() => autoRefresh.stop())
  return autoRefresh
}

function electronWindow(overrides = {}) {
  const remove = () => {}
  window.ftElectron = {
    subscriptionAutoRefresh: {
      isInProgress: async () => ({ inProgress: false, percentage: 0 }),
      backgroundCompleted: async () => {},
      setProgress: () => {},
      onBackgroundResultsAvailable: () => remove,
      onStateChanged: () => remove,
      onCancelRequested: () => remove,
    },
    tabs: { isActive: async () => true, onActiveChanged: () => remove },
    ...overrides,
  }
}

const showApp = () => document.dispatchEvent(new Event('visibilitychange'))

test('concurrent background imports wait for the existing cache import', async t => {
  let finish
  let requests = 0
  const blocked = new Promise(resolve => { finish = resolve })
  hooks.store = createStore()
  hooks.getNextResult = async () => { requests++; await blocked; return null }
  start(t, android, { env: { IS_CAPACITOR: 'true' } })
  showApp()
  showApp()
  await settle()
  assert.equal(requests, 1, 'the second import must reuse the running one')
  finish()
  await settle()
  assert.equal(requests, 1)
  showApp()
  await settle()
  assert.equal(requests, 2, 'a finished import does not block the next one')
})

test('restoring an Electron window imports completed background results', async t => {
  const calls = []
  electronWindow()
  navigator.locks = { request: (_name, callback) => callback() }
  hooks.store = createStore()
  start(t, electron, { env: { IS_ELECTRON: 'true' }, dataReady: true })
  await settle()
  hooks.getNextResult = async () => { calls.push('import'); return null }
  const commit = hooks.store.commit
  hooks.store.commit = (type, value) => {
    if (type.endsWith('NextAutoRefreshTimestamp')) calls.push('schedule')
    commit(type, value)
  }
  showApp()
  await settle()
  assert.equal(calls[0], 'import', 'background results are imported before feeds are rescheduled')
  assert.deepEqual([...new Set(calls)], ['import', 'schedule'])
  assert.equal(calls.filter(call => call === 'import').length, 1)
})

test('an imported background completion prevents an unnecessary foreground refresh', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const refreshes = []
  const acknowledged = []
  const completions = []
  electronWindow()
  window.ftElectron.subscriptionAutoRefresh.backgroundCompleted = async completion => { completions.push(completion) }
  navigator.locks = { request: (_name, callback) => callback() }
  localStorage.clear()
  localStorage.setItem(deadlineKey('all', 'videos'), String(Date.now() - 1000))
  hooks.store = createStore({ getSubscriptionFeedAutoRefreshInterval: '60000' })
  start(t, electron, { env: { IS_ELECTRON: 'true' }, dataReady: true })
  await settle()
  const results = [{ id: 'done', kind: 'completion', profileId: 'all', feedType: 'videos', timestamp: Date.now() }]
  hooks.getNextResult = async () => results.shift() ?? null
  hooks.acknowledge = async id => { acknowledged.push(id) }
  hooks.refresh = async () => { refreshes.push('refresh'); return [] }

  window.dispatchEvent(new Event('online'))
  await settle()
  assert.deepEqual(refreshes, [], 'the feed the background refresh just loaded must not refresh again')
  assert.deepEqual(acknowledged, ['done'])
  assert.equal(completions.length, 1)
  assert.ok(Number(localStorage.getItem(deadlineKey('all', 'videos'))) > Date.now(), 'the next refresh waits a full interval')
})

/**
 * Imports one channel result from the closed-app refresh.
 * @param {import('node:test').TestContext} t
 * @param {object} result
 */
async function importChannelResult(t, result) {
  const results = [{ id: 'channel', kind: 'channel', profileId: 'all', ...result }]
  hooks.getNextResult = async () => results.shift() ?? null
  start(t, android, { env: { IS_CAPACITOR: 'true' } })
  showApp()
  await settle()
}

test('background playlist imports restore missing authors and keep explicit bylines', async t => {
  const published = []
  const cache = { UCchannel: { videos: [{ videoId: 'missing', thumbnailUrl: 'https://images.example/portrait.jpg' }] } }
  let saved
  hooks.store = createStore({
    getSubscribedChannelIdSet: new Set(['UCchannel']),
    getSubscribedChannelsById: new Map([['UCchannel', { id: 'UCchannel', name: 'Subscribed creator' }]]),
    getShortsCache: cache,
  })
  hooks.store.onDispatch = (_action, value) => { saved = value.videos; cache.UCchannel = value; return true }
  hooks.notifySubscriptionChannelRefreshed = tab => published.push(tab)
  hooks.enrichSubscriptionShortDates = async entries => entries.map(entry => ({ ...entry, published: 123456 }))
  await importChannelResult(t, {
    channelId: 'UCchannel', feedType: 'shorts', timestamp: Date.now(),
    payload: { backgroundFormat: 'entries', entries: [
      { videoId: 'missing', author: 'N/A', authorId: 'N/A', isRSS: true },
      { videoId: 'absent', author: '', authorId: '' },
      { videoId: 'explicit', author: 'Explicit creator', authorId: 'UCexplicit' }
    ] }
  })
  assert.equal(saved[0].author, 'Subscribed creator')
  assert.equal(saved[0].authorId, 'UCchannel')
  assert.equal(saved[0].thumbnailUrl, 'https://images.example/portrait.jpg')
  assert.equal(saved[1].author, 'Subscribed creator')
  assert.equal(saved[1].authorId, 'UCchannel')
  assert.equal(saved[2].author, 'Explicit creator')
  assert.equal(saved[2].authorId, 'UCexplicit')
  assert.ok(saved.every(video => video.isShort))
  assert.ok(saved.every(video => video.published === 123456))
  assert.deepEqual(published, ['shorts'], 'publish imported videos while the native refresh is still active')
})

test('background Yattee Shorts are dated through the server instead of YouTube', async t => {
  const cache = { UCchannel: { videos: [{ videoId: 'known', published: 1000 }] } }
  const lookups = []
  const published = []
  let saved
  hooks.store = createStore({
    getBackendPreference: 'yattee',
    getSubscribedChannelIdSet: new Set(['UCchannel']),
    getSubscribedChannelsById: new Map([['UCchannel', { id: 'UCchannel', name: 'Subscribed creator' }]]),
    getShortsCache: cache,
  })
  hooks.store.onDispatch = (_action, value) => { saved = value.videos; cache.UCchannel = value; return true }
  hooks.notifySubscriptionChannelRefreshed = tab => published.push(tab)
  hooks.enrichSubscriptionShortDates = async () => { throw new Error('YouTube must not be contacted') }
  hooks.invidiousGetVideoInformation = async videoId => { lookups.push(videoId); return { published: 2 } }
  await importChannelResult(t, {
    channelId: 'UCchannel', feedType: 'shorts', timestamp: Date.now(),
    payload: { backgroundFormat: 'entries', entries: [
      { videoId: 'known', author: 'Subscribed creator', authorId: 'UCchannel' },
      { videoId: 'new', author: 'Subscribed creator', authorId: 'UCchannel' }
    ] }
  })
  assert.deepEqual(saved.map(video => video.published), [1000, 2000])
  assert.deepEqual(lookups, ['new'])
  assert.deepEqual(published, ['shorts'])
})

test('separate Electron renderers serialize background result imports', async t => {
  let finish
  let requests = 0
  const blocked = new Promise(resolve => { finish = resolve })
  let queue = Promise.resolve()
  navigator.locks = { request(name, callback) {
    assert.equal(name, 'opentubex-background-subscription-import')
    const result = queue.then(callback)
    queue = result.catch(() => {})
    return result
  } }
  electronWindow()
  hooks.store = createStore()
  start(t, electron, { env: { IS_ELECTRON: 'true' } })
  start(t, electron, { env: { IS_ELECTRON: 'true' } })
  await settle()
  hooks.getNextResult = async () => { requests++; await blocked; return null }
  // Both renderers import when they are shown.
  showApp()
  await settle()
  assert.equal(requests, 1, 'the second renderer must wait for the first import to finish')
  finish()
  await settle()
  assert.equal(requests, 2)
})
