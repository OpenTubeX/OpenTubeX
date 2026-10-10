import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { getSubscriptionsForFeed, MAX_INCREMENTAL_SUBSCRIPTION_CHANNELS } from '../../src/renderer/helpers/subscription-channels.js'

async function feed(t, query, initiallyPresented = true) {
  const source = await readFile(new URL('../../src/renderer/composables/useSubscriptionPage.js', import.meta.url), 'utf8')
  const getters = reactive({ getActiveProfile: { subscriptions: [] }, getSubscriptionCacheReady: true })
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
  return { result: create(() => 'videos'), getters, state: context.store.state, presented, activate: () => activate(), deactivate: () => deactivate() }
}

function page(offset = 0, limit = 100) {
  return { records: Array.from({ length: Math.min(limit, 350 - offset) }, (_, index) => ({ videoId: String(offset + index) })), cursor: offset + limit < 350 ? { offset: offset + limit } : null, total: 350, hasNew: false, categoryCounts: {}, nextPremiereTimestamp: null }
}

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

  invalidations = 0
  deactivate()
  activate()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(calls > before + 5, 'a dirty feed retries when presented again')
  assert.equal(result.records.value.length, 300, 'recovery retains the loaded extent')
  assert.equal(result.busy.value, false)
})

test('hidden logical tabs retain their feed and defer changes until presentation', async t => {
  let calls = 0
  const { result, getters, presented } = await feed(t, async (_, options) => { calls++; return page(options.cursor?.offset ?? 0, options.limit) })
  await result.load()
  presented.value = false
  await nextTick()
  const previous = calls
  getters.getHideWatchedSubs = true
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(calls, previous)
  assert.equal(result.records.value.length, 100)
  presented.value = true
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.ok(calls > previous)
})


test('KeepAlive activation does not restart the initial request or a clean cached page', async t => {
  let finish
  let calls = 0
  const { result, activate, deactivate } = await feed(t, () => { calls++; return new Promise(resolve => { finish = resolve }) })
  activate()
  assert.equal(calls, 1)
  finish(page())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(result.records.value.length, 100)
  deactivate()
  activate()
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(calls, 1)
  assert.equal(result.busy.value, false)
})

test('restored background tabs load one bounded initial page before presentation', async t => {
  let calls = 0
  const { result, presented } = await feed(t, async () => { calls++; return page() }, false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal(result.records.value.length, 100)
  presented.value = true
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 120))
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
  const { result, getters, state } = await feed(t, async () => {
    calls++
    return { ...page(), cursor: null, total: 1, records: [{ videoId: 'a', title: String(version) }] }
  })
  await result.load()
  getters.getSubscriptionFeedRefreshInProgress = true
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 150))
  const before = calls
  for (let i = 0; i < 4; i++) {
    version++
    state.subscriptionCache.subscriptionVideosFeedVersion++
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 130))
  }
  assert.ok(calls - before <= 1, 'do not replace the visible page after every channel response')
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(getters.getSubscriptionFeedRefreshInProgress, true)
  assert.equal(result.records.value[0].title, '4', 'incremental cards publish while the refresh is running')
  getters.getSubscriptionFeedRefreshInProgress = false
  await nextTick()
})

test('starting a large refresh cancels pending page loads before early channel responses can publish', async t => {
  let calls = 0
  let title = 'Original'
  const { result, getters, state } = await feed(t, async () => {
    calls++
    return { ...page(), cursor: null, total: 1, records: [{ videoId: 'a', title }] }
  })
  getters.getActiveProfile.subscriptions = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }))
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 150))
  // A pending refresh can come from another completed channel update.
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await nextTick()
  const before = calls
  getters.getSubscriptionFeedRefreshInProgress = true
  await nextTick()
  title = 'Refreshed'
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(calls, before, 'starting a large refresh must cancel its pending reload')
  assert.equal(result.records.value[0].title, 'Original')
  assert.equal(result.busy.value, false)
  getters.getSubscriptionFeedRefreshInProgress = false
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(result.records.value[0].title, 'Refreshed')
})

test('large channel refreshes defer page publication even when their initial cache is empty', async t => {
  let calls = 0
  let version = 0
  const { result, getters, state } = await feed(t, async () => {
    calls++
    return { ...page(), cursor: null, total: 1, records: [{ videoId: 'a', title: String(version) }] }
  })
  getters.getActiveProfile.subscriptions = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }))
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 150))
  getters.getSubscriptionFeedRefreshInProgress = true
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 150))
  const before = calls
  version++
  state.subscriptionCache.subscriptionVideosFeedVersion++
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 1250))
  assert.equal(calls, before, 'match the existing large-channel refresh policy even before cached entry counts grow')
  getters.getSubscriptionFeedRefreshInProgress = false
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(result.records.value[0].title, '1', 'completion or cancellation publishes all successfully saved channels')
})
