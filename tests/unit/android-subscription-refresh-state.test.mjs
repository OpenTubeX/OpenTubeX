import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { ref } from 'vue'
import {
  createStore,
  deadlineKey,
  events,
  hooks,
  loadSubscriptionAutoRefresh,
  PROGRESS_STORAGE_KEY,
  settle,
} from '../helpers/subscription-auto-refresh.mjs'

const { useSubscriptionAutoRefresh } = await loadSubscriptionAutoRefresh({ IS_CAPACITOR: 'true' })

/** The refresh states the composable published, from its store commits. */
function shownStates(store) {
  const shown = []
  for (const [type, value] of store.commits) {
    if (type === 'setSubscriptionFeedRefreshInProgress') shown.push({ inProgress: value })
    else if (type === 'setSubscriptionFeedRefreshTab') shown.at(-1).tab = value
    else if (type === 'setSubscriptionFeedRefreshProgress') shown.at(-1).percentage = value
  }
  return shown
}

function setup(t, state, hidden = false) {
  const timers = new Map()
  const calls = []
  const notifications = []
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const { setTimeout: realSetTimeout, clearTimeout: realClearTimeout } = globalThis
  globalThis.setTimeout = callback => { const id = Symbol('timer'); timers.set(id, callback); return id }
  globalThis.clearTimeout = id => timers.delete(id)
  hooks.store = createStore()
  hooks.store.onDispatch = action => { calls.push(action) }
  hooks.getAndroidState = async () => state
  hooks.isAppHidden = () => hidden
  hooks.getNextResult = async () => { calls.push('import'); return null }
  hooks.notifySubscriptionChannelRefreshed = tab => notifications.push(tab)
  navigator.locks = { query() { assert.fail('Android must use native ownership') } }

  const autoRefresh = useSubscriptionAutoRefresh({ dataReady: ref(false), t: key => key })
  t.after(() => {
    autoRefresh.stop()
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  })
  let started = false
  return {
    timers, calls, notifications,
    get shown() { return shownStates(hooks.store) },
    advance: milliseconds => { now += milliseconds },
    // Starting reads the native state once; another tab's progress update reads it again.
    synchronize: async () => {
      if (started) {
        window.dispatchEvent(Object.assign(new Event('storage'), { key: PROGRESS_STORAGE_KEY, newValue: '{}' }))
      } else {
        started = true
        autoRefresh.start()
      }
      await settle()
    },
  }
}

test('the first idle native read reloads the cache once after the startup load', async t => {
  const app = setup(t, { inProgress: false, ownedByRenderer: false, rendererActive: false })
  await app.synchronize()
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions'])
  assert.deepEqual(app.notifications, ['videos', 'shorts', 'live', 'posts'])
  assert.equal(app.timers.size, 0)
  app.advance(10000)
  await app.synchronize()
  assert.equal(app.calls.filter(call => call === 'grabAllSubscriptions').length, 1, 'unchanged idle reads do not repeat the reload')
})

test('reopening Android follows native progress and imports videos before the worker finishes', async t => {
  const state = { inProgress: true, percentage: 42, tab: 'shorts', ownedByRenderer: false }
  const app = setup(t, state)
  await app.synchronize()
  assert.equal(app.shown[0].inProgress, true, 'a moving native refresh must be visible in the reopened app')
  assert.equal(app.shown[0].percentage, 42)
  assert.equal(app.shown[0].tab, 'shorts')
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions'])
  assert.equal(app.timers.size, 1)

  state.percentage = 73
  await [...app.timers.values()][0]()
  assert.equal(app.shown.at(-1).percentage, 73)
  assert.equal(app.timers.size, 1)

  state.inProgress = false
  state.percentage = 0
  await [...app.timers.values()][0]()
  assert.equal(app.shown.at(-1).inProgress, false)
  assert.equal(app.timers.size, 0)
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions', 'import', 'import'])
})

test('retained renderer cache writes become visible during refresh and after completion', async t => {
  const state = { inProgress: true, percentage: 42, tab: 'videos', ownedByRenderer: false, rendererActive: true }
  const app = setup(t, state)
  await app.synchronize()
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions'])
  await app.synchronize()
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions', 'import'])
  state.percentage = 50
  app.advance(5000)
  await app.synchronize()
  assert.equal(app.calls.at(-1), 'grabAllSubscriptions')
  state.inProgress = false
  state.rendererActive = false
  await app.synchronize()
  assert.equal(app.calls.at(-1), 'grabAllSubscriptions')
  assert.equal(app.shown.at(-1).inProgress, false)
})

test('frequent retained renderer progress reloads the cache at most every five seconds and immediately on completion', async t => {
  const state = { inProgress: true, percentage: 0, tab: 'videos', ownedByRenderer: false, rendererActive: true }
  const app = setup(t, state)
  for (let percentage = 0; percentage < 60; percentage++) {
    if (percentage > 0) app.advance(1000)
    state.percentage = percentage
    await app.synchronize()
    assert.equal(app.shown.at(-1).percentage, percentage, 'progress stays live between cache reloads')
  }
  assert.equal(app.calls.filter(call => call === 'grabAllSubscriptions').length, 12)
  assert.equal(app.notifications.length, 12 * 4, 'feed rebuilds share the cache reload limit')

  state.inProgress = false
  state.rendererActive = false
  await app.synchronize()
  assert.equal(app.calls.filter(call => call === 'grabAllSubscriptions').length, 13, 'completion flushes the last writes')
  assert.equal(app.notifications.length, 13 * 4)
  await app.synchronize()
  assert.equal(app.calls.filter(call => call === 'grabAllSubscriptions').length, 13, 'completion is imported once')
})

test('an owned Refresh All batch keeps its renderer events and next-feed startup', async t => {
  const app = setup(t, { inProgress: true, ownedByRenderer: true })
  await app.synchronize()
  assert.deepEqual(app.shown, [])
  assert.deepEqual(app.calls, [])
  assert.equal(app.timers.size, 0)
})

test('a hidden renderer does not poll or import another workers results', async t => {
  const app = setup(t, { inProgress: true, ownedByRenderer: false }, true)
  await app.synchronize()
  assert.deepEqual(app.calls, [])
  assert.equal(app.timers.size, 0)
})

async function setupCancellation(t, { deadline = Date.now() - 1000, enabled = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  localStorage.clear()
  if (deadline !== null) localStorage.setItem(deadlineKey('all', 'videos'), String(deadline))
  hooks.store = createStore({ getSubscriptionFeedAutoRefreshInterval: enabled ? '60000' : '0' })
  const autoRefresh = useSubscriptionAutoRefresh({ dataReady: ref(true), t: key => key })
  autoRefresh.start()
  t.after(() => autoRefresh.stop())
  await settle()
  hooks.store.commits.length = 0

  const calls = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } }, window, CustomEvent,
    cancelAndroidSubscriptionRefresh: () => calls.push('cancel'),
    activeRefresh: null, cancelCount: 1,
    store: { getters: { getSubscriptionFeedRefreshInProgress: true, getSubscriptionFeedRefreshTab: 'videos', getActiveProfile: { _id: 'all' } } },
    localStorage: { setItem() {} },
    SUBSCRIPTION_REFRESH_CANCELLED_EVENT: events.cancelled, SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY: 'cancel',
  })
  const subscriptions = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
  const localCancellationStart = subscriptions.indexOf('export function cancelSubscriptionRefresh()')
  vm.runInContext(subscriptions.slice(localCancellationStart, subscriptions.indexOf('\n/**', localCancellationStart)).replace('export ', ''), context)
  const cancellationStart = subscriptions.indexOf('export function requestSubscriptionRefreshCancellation()')
  vm.runInContext(subscriptions.slice(cancellationStart, subscriptions.indexOf('\n/**', cancellationStart)).replace('export ', ''), context)
  return {
    context,
    calls,
    /** The stored deadline and the deadline each timer change published */
    deadlines() {
      const stored = localStorage.getItem(deadlineKey('all', 'videos'))
      return {
        stored: stored === null ? null : Number(stored),
        scheduled: hooks.store.commits
          .filter(([type]) => type === 'setSubscriptionFeedNextAutoRefreshTimestamp')
          .map(([, timestamp]) => timestamp),
      }
    },
  }
}

test('cancelling native work from a reopened renderer postpones its overdue refresh', async t => {
  const { context, calls, deadlines } = await setupCancellation(t)
  const before = Date.now()
  context.requestSubscriptionRefreshCancellation()
  assert.deepEqual(calls, ['cancel'])
  const { stored, scheduled } = deadlines()
  assert.ok(stored >= before + 60000)
  assert.deepEqual(scheduled, [stored])
})

test('notification cancellation postpones native work without sending another native cancel request', async t => {
  const { context, calls, deadlines } = await setupCancellation(t)
  const before = Date.now()
  // This is the callback registered with addAndroidSubscriptionRefreshCancelledListener.
  context.cancelSubscriptionRefresh()
  assert.deepEqual(calls, [], 'the native cancellation must not recursively request cancellation')
  const { stored, scheduled } = deadlines()
  assert.ok(stored >= before + 60000, 'the native notification must advance the overdue deadline')
  assert.deepEqual(scheduled, [stored], 'the native notification must move the timer')
})

for (const method of ['requestSubscriptionRefreshCancellation', 'cancelSubscriptionRefresh']) {
  test(`${method} keeps an existing future automatic-refresh deadline`, async t => {
    const deadline = Date.now() + 120000
    const { context, deadlines } = await setupCancellation(t, { deadline })
    context[method]()
    assert.deepEqual(deadlines(), { stored: deadline, scheduled: [deadline] })
  })

  test(`${method} schedules a missing automatic-refresh deadline`, async t => {
    const { context, deadlines } = await setupCancellation(t, { deadline: null })
    const before = Date.now()
    context[method]()
    const { stored, scheduled } = deadlines()
    assert.ok(stored >= before + 60000)
    assert.deepEqual(scheduled, [stored])
  })

  test(`${method} clears the deadline when automatic refresh is disabled`, async t => {
    const { context, deadlines } = await setupCancellation(t, { deadline: Date.now() + 120000, enabled: false })
    context[method]()
    assert.deepEqual(deadlines(), { stored: null, scheduled: [null] })
  })
}
