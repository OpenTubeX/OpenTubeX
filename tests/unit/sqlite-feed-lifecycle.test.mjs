import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { getSubscriptionsForFeed, MAX_INCREMENTAL_SUBSCRIPTION_CHANNELS } from '../../src/renderer/helpers/subscription-channels.js'

async function feed(t, query, initiallyPresented = true, initialExtent = () => 100, sortPreference = () => null, initiallyReady = true) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 })
  const advance = async milliseconds => {
    await nextTick()
    t.mock.timers.tick(milliseconds)
    await new Promise(resolve => setImmediate(resolve))
  }
  const source = await readFile(new URL('../../src/renderer/composables/useSubscriptionPage.js', import.meta.url), 'utf8')
  const getters = reactive({ getActiveProfile: { _id: 'profile-a', subscriptions: [] }, getSubscriptionCacheReady: initiallyReady, getSubscriptionFeedRefreshTab: 'videos' })
  const presented = ref(initiallyPresented)
  let activate
  let deactivate
  const stops = []
  const timers = new Set()
  const context = {
    computed, ref, shallowRef, console, Date, process: { env: { IS_ELECTRON: true } },
    watch: (...args) => { const stop = watch(...args); stops.push(stop); return stop },
    onActivated(callback) { activate = callback }, onDeactivated(callback) { deactivate = callback }, onBeforeUnmount(callback) { t.after(callback) },
    useTabContext: () => ({ isTabPresented: presented }),
    store: { getters, state: reactive({ history: { historyRevision: 0 }, subscriptionCache: { videoCache: {}, shortsCache: {}, liveCache: {}, postsCache: {}, subscriptionVideosFeedVersion: 0 } }) },
    DBLibraryHandlers: { query }, hasConfiguredRestrictedPlaybackAuthentication: () => false,
    MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES: 500,
    MAX_INCREMENTAL_SUBSCRIPTION_CHANNELS, getSubscriptionsForFeed,
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timers.add(timer); return timer }, clearTimeout,
  }
  t.after(() => { stops.forEach(stop => stop()); timers.forEach(clearTimeout) })
  const create = vm.runInNewContext(source.replace(/^import .*\n/gm, '').replace('export function', 'function') + '\nuseSubscriptionPage', context)
  return { result: create(() => 'videos', () => false, () => true, () => 100, initialExtent, sortPreference), getters, state: context.store.state, presented, advance, activate: () => activate(), deactivate: () => deactivate() }
}

test('restored feed extent loads bounded pages before reporting completion and can force newest Home order', async t => {
  const calls = []
  const { result, getters } = await feed(t, async (_, options) => {
    calls.push({ limit: options.limit, sort: options.preferences.sortBy })
    return page(options.cursor?.offset ?? 0, options.limit)
  }, true, () => 300, () => 'newest')
  getters.getNewSubscriptionFeedSortBy = 'oldest'
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(result.records.value.length, 300)
  assert.equal(result.busy.value, false)
  assert.ok(calls.every(call => call.limit <= 250 && call.sort === 'newest'))
})

function page(offset = 0, limit = 100) {
  return { records: Array.from({ length: Math.min(limit, 350 - offset) }, (_, index) => ({ videoId: String(offset + index) })), cursor: offset + limit < 350 ? { offset: offset + limit } : null, total: 350, hasNew: false, categoryCounts: {}, nextPremiereTimestamp: null }
}

for (const lifecycle of ['mounted', 'KeepAlive', 'logical tab']) {
  test(`profile changes synchronously clear a ${lifecycle} feed while same-profile failures retain completed pages`, async t => {
    let fail = false
    const { result, getters, deactivate, activate, presented } = await feed(t, async () => {
      if (fail) throw new Error('profile feed unavailable')
      return { ...page(), hasNew: true, categoryCounts: { videos: 350 } }
    })
    await result.load()
    assert.equal(result.records.value.length, 100)
    if (lifecycle === 'KeepAlive') deactivate()
    if (lifecycle === 'logical tab') { presented.value = false; await nextTick() }
    fail = true
    getters.getActiveProfile = { _id: 'profile-b', subscriptions: [] }
    assert.equal(result.records.value.length, 0, 'the old profile must disappear before the next Vue tick')
    assert.equal(result.cursor.value, null)
    assert.equal(result.total.value, 0)
    assert.equal(result.hasNew.value, false)
    assert.deepEqual(Object.keys(result.categoryCounts.value), [])
    await nextTick()
    if (lifecycle === 'KeepAlive') activate()
    if (lifecycle === 'logical tab') { presented.value = true; await nextTick() }
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(result.failed.value, true)
    assert.equal(result.records.value.length, 0)
    fail = false
    await result.load()
    const retained = result.records.value
    fail = true
    await assert.rejects(result.load(), /profile feed unavailable/)
    assert.equal(result.records.value, retained, 'a failure within the same profile preserves its completed pages')
  })
}

test('a response from the previous profile cannot replace a completed new-profile page', async t => {
  const pending = []
  const { result, getters } = await feed(t, () => new Promise(resolve => pending.push(resolve)))
  getters.getActiveProfile = { _id: 'profile-b', subscriptions: [] }
  await nextTick()
  assert.equal(pending.length, 2)
  pending[1]({ ...page(), records: [{ videoId: 'profile-b' }], cursor: null })
  await new Promise(resolve => setImmediate(resolve))
  pending[0]({ ...page(), records: [{ videoId: 'profile-a' }], cursor: null })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(Array.from(result.records.value, record => record.videoId), ['profile-b'])
})

test('initial paged feed is busy immediately and fetches without a debounce delay', async t => {
  let finish
  let calls = 0
  const { result } = await feed(t, () => { calls++; return new Promise(resolve => { finish = resolve }) })
  assert.equal(result.busy.value, true)
  assert.equal(calls, 1)
  finish(page())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(result.records.value.length, 100)
  assert.equal(result.busy.value, false)
})

test('adding an already-cached subscription in place reloads the active profile feed', async t => {
  const calls = []
  const { result, getters, advance } = await feed(t, async (_, options) => {
    calls.push(options.subscriptions.map(channel => channel.id))
    return { ...page(), records: options.subscriptions.map(channel => ({ videoId: channel.id })), cursor: null }
  })
  await result.load()
  const before = calls.length
  getters.getActiveProfile.subscriptions.push({ id: 'cached-channel' })
  await nextTick()
  await advance(120)
  assert.equal(calls.length, before + 1)
  assert.deepEqual(calls.at(-1), ['cached-channel'])
  assert.deepEqual(Array.from(result.records.value, record => record.videoId), ['cached-channel'])
})

for (const lifecycle of ['KeepAlive', 'logical tab']) {
  test(`a ${lifecycle} deactivation cancels initial feed publication and retries when shown`, async t => {
    const pending = []
    const { result, activate, deactivate, presented } = await feed(t, () => new Promise(resolve => pending.push(resolve)))
    assert.equal(pending.length, 1)
    if (lifecycle === 'KeepAlive') deactivate()
    else { presented.value = false; await nextTick() }
    assert.equal(result.busy.value, false)
    pending[0](page())
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(result.records.value.length, 0, 'a response to an explicitly suspended initial request cannot publish')
    if (lifecycle === 'KeepAlive') activate()
    else { presented.value = true; await nextTick() }
    assert.equal(pending.length, 2)
    pending[1](page())
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(result.records.value.length, 100)
    assert.equal(result.busy.value, false)
  })
}

test('reload and expired cursor retain the previously loaded feed extent', async t => {
  let stale = false
  const { result } = await feed(t, async (_, options) => {
    if (stale && options.cursor) { stale = false; return { stale: true } }
    return page(options.cursor?.offset ?? 0, options.limit)
  })
  await result.load()
  await result.more()
  assert.equal(result.records.value.length, 200)
  await result.load()
  assert.equal(result.records.value.length, 200)
  stale = true
  await result.more()
  assert.equal(result.records.value.length, 300)
})

test('a rejected next subscription page retains the complete page and exposes a recoverable failure', async t => {
  let fail = false
  const { result } = await feed(t, async (_, options) => {
    if (fail) throw new Error('simulated subscription page failure')
    return page(options.cursor?.offset ?? 0, options.limit)
  })
  await result.load()
  const previous = result.records.value
  const previousCursor = result.cursor.value
  fail = true
  await assert.rejects(result.more(), /simulated subscription page failure/)
  assert.equal(result.records.value, previous)
  assert.equal(result.cursor.value, previousCursor)
  assert.equal(result.total.value, 350)
  assert.equal(result.busy.value, false)
  assert.equal(result.failed.value, true)
  fail = false
  await result.more()
  assert.equal(result.records.value.length, 200)
  assert.equal(result.failed.value, false)
  assert.equal(result.busy.value, false)
})

test('a superseded subscription page rejection cannot replace current recovery state', async t => {
  let reject
  const { result } = await feed(t, async (_, options) => {
    if (options.cursor) return new Promise((_, fail) => { reject = fail })
    return page(0, options.limit)
  })
  await result.load()
  const rejected = assert.rejects(result.more(), /superseded failure/)
  await result.load()
  const current = result.records.value
  reject(new Error('superseded failure'))
  await rejected
  assert.equal(result.records.value, current)
  assert.equal(result.failed.value, false)
  assert.equal(result.busy.value, false)
})

test('an empty subscription page cannot cause an unbounded cursor loop', async t => {
  let empty = false
  let calls = 0
  const { result } = await feed(t, async (_, options) => {
    if (!empty) return page(options.cursor?.offset ?? 0, options.limit)
    if (++calls > 3) throw new Error('Subscription pagination did not stop')
    return { ...page(), records: [], cursor: { offset: 100 } }
  })
  await result.load()
  const previous = result.records.value
  empty = true
  await result.more()
  assert.equal(calls, 1)
  assert.equal(result.records.value, previous, 'an empty page must retain the loaded cards')
  assert.equal(result.busy.value, false)
})

test('repeated cursor invalidation bounds reload work and retains the last complete feed until recovery', async t => {
  let invalidations = 0
  let calls = 0
  const { result, activate, deactivate } = await feed(t, async (_, options) => {
    calls++
    if (invalidations > 0 && options.cursor) { invalidations--; return { stale: true } }
    return page(options.cursor?.offset ?? 0, options.limit)
  })
  await result.load()
  await result.more()
  await result.more()
  const previous = result.records.value
  const previousCursor = result.cursor.value
  const before = calls
  invalidations = 10
  await result.more()
  assert.ok(calls - before <= 5, 'one append plus at most two restarts must bound repeated cursor invalidation')
  assert.equal(result.records.value, previous, 'incomplete reloads must not replace the last complete feed')
  assert.equal(result.cursor.value, previousCursor)
  assert.equal(result.total.value, 350)
  assert.equal(result.busy.value, false)
  assert.equal(result.failed.value, true, 'automatic pagination must pause instead of restarting an invalid cursor forever')

  invalidations = 0
  deactivate()
  activate()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(calls > before + 5, 'a dirty feed retries when presented again')
  assert.equal(result.records.value.length, 300, 'recovery retains the loaded extent')
  assert.equal(result.busy.value, false)
  assert.equal(result.failed.value, false)
})

test('hidden logical tabs retain their feed and defer changes until presentation', async t => {
  let calls = 0
  const { result, getters, presented, advance } = await feed(t, async (_, options) => { calls++; return page(options.cursor?.offset ?? 0, options.limit) })
  await result.load()
  presented.value = false
  await nextTick()
  const previous = calls
  getters.getHideWatchedSubs = true
  await nextTick()
  await advance(120)
  assert.equal(calls, previous)
  assert.equal(result.records.value.length, 100)
  presented.value = true
  await nextTick()
  await advance(120)
  assert.ok(calls > previous)
})


test('KeepAlive activation does not restart the initial request or a clean cached page', async t => {
  let finish
  let calls = 0
  const { result, activate, deactivate, advance } = await feed(t, () => { calls++; return new Promise(resolve => { finish = resolve }) })
  activate()
  assert.equal(calls, 1)
  finish(page())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(result.records.value.length, 100)
  deactivate()
  activate()
  await advance(120)
  assert.equal(calls, 1)
  assert.equal(result.busy.value, false)
})

test('restored background tabs load one bounded initial page before presentation', async t => {
  let calls = 0
  const { result, presented, advance } = await feed(t, async () => { calls++; return page() }, false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal(result.records.value.length, 100)
  presented.value = true
  await nextTick()
  await advance(120)
  assert.equal(calls, 1)
})


test('refreshing the same bounded page preserves unchanged card objects and publishes changed metadata', async t => {
  let title = 'Original'
  let date = new Date(0)
  const { result } = await feed(t, async () => ({ ...page(), cursor: null, total: 2, records: [
    { videoId: 'a', title, unknown: { date: new Date(date), values: [1, 2] } },
    { videoId: 'b', title: 'Stable' },
  ] }))
  await result.load()
  const original = result.records.value
  await result.load()
  assert.equal(result.records.value, original, 'unchanged responses must not rerender the list')
  title = 'Changed'
  await result.load()
  assert.notEqual(result.records.value[0], original[0])
  assert.equal(result.records.value[0].title, 'Changed')
  assert.equal(result.records.value[1], original[1], 'unchanged cards retain their props')
  date = new Date(1000)
  await result.load()
  assert.equal(result.records.value[0].unknown.date.getTime(), 1000, 'unknown Date changes are not mistaken for equal empty objects')
})

test('network channel updates are coalesced while still publishing before refresh completion', async t => {
  let calls = 0
  let version = 0
  const { result, getters, state, advance } = await feed(t, async () => {
    calls++
    return { ...page(), cursor: null, total: 1, records: [{ videoId: 'a', title: String(version) }] }
  })
  await result.load()
  getters.getSubscriptionFeedRefreshInProgress = true
  await nextTick()
  await advance(150)
  const before = calls
  for (let i = 0; i < 4; i++) {
    version++
    state.subscriptionCache.subscriptionVideosFeedVersion++
    await nextTick()
    await advance(130)
  }
  assert.ok(calls - before <= 1, 'do not replace the visible page after every channel response')
  await advance(480)
  assert.equal(calls, before, 'the coalescing interval schedules the page debounce before querying')
  await advance(99)
  assert.equal(calls, before)
  await advance(1)
  assert.equal(getters.getSubscriptionFeedRefreshInProgress, true)
  assert.equal(result.records.value[0].title, '4', 'incremental cards publish while the refresh is running')
  getters.getSubscriptionFeedRefreshInProgress = false
  await nextTick()
})

test('consecutive feed refreshes publish the completed feed before deferring the next large feed', async t => {
  let title = 'Original'
  const { result, getters, state, advance } = await feed(t, async () => ({ ...page(), records: [{ videoId: 'v', title }], cursor: null }))
  getters.getActiveProfile.subscriptions.push({ id: 'channel' })
  state.subscriptionCache.videoCache.channel = { count: 1 }
  await advance(120)
  getters.getSubscriptionFeedRefreshTab = 'videos'
  getters.getSubscriptionFeedRefreshInProgress = true
  await advance(120)
  title = 'Finished Videos snapshot'
  state.subscriptionCache.videoCache.channel.count = 501
  state.subscriptionCache.subscriptionVideosFeedVersion++
  getters.getSubscriptionFeedRefreshTab = 'shorts'
  await advance(0)
  assert.equal(result.records.value[0].title, 'Finished Videos snapshot')
  title = 'Pending large-cache update'
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await advance(1200)
  assert.equal(result.records.value[0].title, 'Finished Videos snapshot')
  state.subscriptionCache.videoCache.channel.count = 1
  getters.getSubscriptionFeedRefreshTab = 'live'
  await advance(120)
  assert.equal(result.records.value[0].title, 'Pending large-cache update')
})

test('starting a large refresh cancels pending page loads before early channel responses can publish', async t => {
  let calls = 0
  let title = 'Original'
  const { result, getters, state, advance } = await feed(t, async () => {
    calls++
    return { ...page(), cursor: null, total: 1, records: [{ videoId: 'a', title }] }
  })
  getters.getActiveProfile.subscriptions = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }))
  await nextTick()
  await advance(150)
  // A pending refresh can come from another completed channel update.
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await nextTick()
  const before = calls
  getters.getSubscriptionFeedRefreshInProgress = true
  await nextTick()
  title = 'Refreshed'
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await nextTick()
  await advance(150)
  assert.equal(calls, before, 'starting a large refresh must cancel its pending reload')
  assert.equal(result.records.value[0].title, 'Original')
  assert.equal(result.busy.value, false)
  getters.getSubscriptionFeedRefreshInProgress = false
  await nextTick()
  await advance(150)
  assert.equal(result.records.value[0].title, 'Refreshed')
})

test('large channel refreshes defer page publication even when their initial cache is empty', async t => {
  let calls = 0
  let version = 0
  const { result, getters, state, advance } = await feed(t, async () => {
    calls++
    return { ...page(), cursor: null, total: 1, records: [{ videoId: 'a', title: String(version) }] }
  })
  getters.getActiveProfile.subscriptions = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }))
  await nextTick()
  await advance(150)
  getters.getSubscriptionFeedRefreshInProgress = true
  await nextTick()
  await advance(150)
  const before = calls
  version++
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await nextTick()
  await advance(1250)
  assert.equal(calls, before, 'match the existing large-channel refresh policy even before cached entry counts grow')
  getters.getSubscriptionFeedRefreshInProgress = false
  await nextTick()
  await advance(150)
  assert.equal(result.records.value[0].title, '1', 'completion or cancellation publishes all successfully saved channels')
})

for (const lifecycle of ['KeepAlive', 'logical tab']) {
  test(`an initial cache-not-ready feed releases busy and starts when ready after ${lifecycle} resume`, async t => {
    let calls = 0
    const { result, getters, presented, activate, deactivate } = await feed(t, async () => { calls++; return page() }, true, () => 100, () => null, false)
    assert.equal(result.busy.value, false)
    assert.equal(calls, 0)
    if (lifecycle === 'KeepAlive') { deactivate(); activate() }
    else { presented.value = false; await nextTick(); presented.value = true; await nextTick() }
    assert.equal(result.busy.value, false)
    getters.getSubscriptionCacheReady = true
    await nextTick(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(result.busy.value, false)
    assert.equal(result.records.value.length, 100)
    assert.equal(calls, 1)
  })
}

test('an unrelated large-category refresh keeps local visible feed updates responsive', async t => {
  let title = 'Original'
  const { result, getters, state, advance } = await feed(t, async () => ({ ...page(), cursor: null, total: 1, records: [{ videoId: 'a', title }] }))
  getters.getActiveProfile.subscriptions = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }))
  await advance(150)
  getters.getSubscriptionFeedRefreshTab = 'shorts'
  getters.getSubscriptionFeedRefreshInProgress = true
  await nextTick()
  title = 'Updated'
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await advance(1250)
  await advance(150)
  assert.equal(result.records.value[0].title, 'Updated')
})
