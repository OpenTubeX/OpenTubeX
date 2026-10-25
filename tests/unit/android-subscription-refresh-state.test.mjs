import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/app/useSubscriptionAutoRefresh.js', import.meta.url), 'utf8')
const start = source.indexOf('async function synchronizeSubscriptionRefreshInProgress()')
const synchronize = source.slice(start, source.indexOf('\n  /**', start))

function setup(state, hidden = false) {
  const shown = []
  const timers = new Map()
  const calls = []
  const notifications = []
  let now = 0
  const context = vm.createContext({
    performance: { now: () => now },
    process: { env: { IS_CAPACITOR: true } },
    navigator: { locks: { query() { assert.fail('Android must use native ownership') } } },
    getAndroidSubscriptionRefreshState: async () => state,
    applySubscriptionAutoRefreshState: value => { shown.push({ ...value }) },
    isAppHidden: () => hidden,
    setTimeout: callback => { const id = Symbol(); timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
    androidSubscriptionRefreshStateTimer: null,
    subscriptionAutoRefreshTabs: ['videos', 'shorts', 'live', 'posts'],
    notifySubscriptionChannelRefreshed: tab => notifications.push(tab),
    subscriptionCacheReady: { value: true },
    reconcileAndroidSubscriptionRefreshResults: async () => { calls.push('import') },
    store: { dispatch: async action => { calls.push(action) } },
  })
  vm.runInContext(source.slice(source.indexOf('let androidExternalRefreshProgress'), source.indexOf('const pendingSubscriptionAutoRefreshes')), context)
  vm.runInContext(synchronize, context)
  return {
    shown, timers, calls, notifications,
    advance: milliseconds => { now += milliseconds },
    synchronize: () => context.synchronizeSubscriptionRefreshInProgress(),
  }
}

test('the first idle native read reloads the cache once after the startup load', async () => {
  const app = setup({ inProgress: false, ownedByRenderer: false, rendererActive: false })
  await app.synchronize()
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions'])
  assert.deepEqual(app.notifications, ['videos', 'shorts', 'live', 'posts'])
  assert.equal(app.timers.size, 0)
  app.advance(10000)
  await app.synchronize()
  assert.equal(app.calls.filter(call => call === 'grabAllSubscriptions').length, 1, 'unchanged idle reads do not repeat the reload')
})

test('reopening Android follows native progress and imports videos before the worker finishes', async () => {
  const state = { inProgress: true, percentage: 42, tab: 'shorts', ownedByRenderer: false }
  const app = setup(state)
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

test('retained renderer cache writes become visible during refresh and after completion', async () => {
  const state = { inProgress: true, percentage: 42, tab: 'videos', ownedByRenderer: false, rendererActive: true }
  const app = setup(state)
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

test('frequent retained renderer progress reloads the cache at most every five seconds and immediately on completion', async () => {
  const state = { inProgress: true, percentage: 0, tab: 'videos', ownedByRenderer: false, rendererActive: true }
  const app = setup(state)
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

test('an owned Refresh All batch keeps its renderer events and next-feed startup', async () => {
  const app = setup({ inProgress: true, ownedByRenderer: true })
  await app.synchronize()
  assert.deepEqual(app.shown, [])
  assert.deepEqual(app.calls, [])
  assert.equal(app.timers.size, 0)
})

test('a hidden renderer does not poll or import another workers results', async () => {
  const app = setup({ inProgress: true, ownedByRenderer: false }, true)
  await app.synchronize()
  assert.deepEqual(app.calls, [])
  assert.equal(app.timers.size, 0)
})

async function setupCancellation({ deadline = Date.now() - 1000, enabled = true } = {}) {
  const events = []
  const window = new EventTarget()
  const calls = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } }, window, CustomEvent,
    cancelAndroidSubscriptionRefresh: () => calls.push('cancel'),
    activeRefresh: null, cancelCount: 1,
    store: { getters: { getSubscriptionFeedRefreshInProgress: true, getSubscriptionFeedRefreshTab: 'videos', getActiveProfile: { _id: 'all' } } },
    localStorage: { setItem() {} },
    SUBSCRIPTION_REFRESH_CANCELLED_EVENT: 'cancelled', SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY: 'cancel',
    activeSubscriptionProfileId: { value: 'all' }, subscriptionAutoRefreshTabs: ['videos'],
    cancelledSubscriptionAutoRefreshKeys: new Set(),
    isSubscriptionTabAutoRefreshEnabled: () => enabled,
    getSubscriptionTabAutoRefreshInterval: () => 60000,
    getStoredSubscriptionTabNextAutoRefreshTimestamp: () => deadline,
    setStoredSubscriptionTabNextAutoRefreshTimestamp: (...args) => events.push(args),
    scheduleSubscriptionTabAutoRefresh: (...args) => events.push(args),
  })
  const subscriptions = await readFile(new URL('../../src/renderer/helpers/subscription-refresh-state.js', import.meta.url), 'utf8')
  const localCancellationStart = subscriptions.indexOf('export function cancelSubscriptionRefresh()')
  vm.runInContext(subscriptions.slice(localCancellationStart, subscriptions.indexOf('\n/**', localCancellationStart)).replace('export ', ''), context)
  const cancellationStart = subscriptions.indexOf('export function requestSubscriptionRefreshCancellation()')
  vm.runInContext(subscriptions.slice(cancellationStart, subscriptions.indexOf('\n/**', cancellationStart)).replace('export ', ''), context)
  const handlerStart = source.indexOf('function handleSubscriptionRefreshCancelled(event)')
  vm.runInContext(source.slice(handlerStart, source.indexOf('\n  /**', handlerStart)), context)
  window.addEventListener('cancelled', event => context.handleSubscriptionRefreshCancelled(event))
  return { context, calls, events }
}

test('cancelling native work from a reopened renderer postpones its overdue refresh', async () => {
  const { context, calls, events } = await setupCancellation()
  const before = Date.now()
  context.requestSubscriptionRefreshCancellation()
  assert.deepEqual(calls, ['cancel'])
  assert.equal(events.length, 2)
  assert.deepEqual(events[0].slice(0, 2), ['all', 'videos'])
  assert.ok(events[0][2] >= before + 60000)
  assert.deepEqual(events[1], ['videos', 'all', events[0][2]])
})

test('notification cancellation postpones native work without sending another native cancel request', async () => {
  const { context, calls, events } = await setupCancellation()
  const before = Date.now()
  // This is the callback registered with addAndroidSubscriptionRefreshCancelledListener.
  context.cancelSubscriptionRefresh()
  assert.deepEqual(calls, [], 'the native cancellation must not recursively request cancellation')
  assert.equal(events.length, 2, 'the native notification must advance the overdue deadline and timer')
  assert.deepEqual(events[0].slice(0, 2), ['all', 'videos'])
  assert.ok(events[0][2] >= before + 60000)
  assert.deepEqual(events[1], ['videos', 'all', events[0][2]])
})

for (const method of ['requestSubscriptionRefreshCancellation', 'cancelSubscriptionRefresh']) {
  test(`${method} keeps an existing future automatic-refresh deadline`, async () => {
    const deadline = Date.now() + 120000
    const { context, events } = await setupCancellation({ deadline })
    context[method]()
    assert.deepEqual(events, [['all', 'videos', deadline], ['videos', 'all', deadline]])
  })

  test(`${method} schedules a missing automatic-refresh deadline`, async () => {
    const { context, events } = await setupCancellation({ deadline: null })
    const before = Date.now()
    context[method]()
    assert.equal(events.length, 2)
    assert.ok(events[0][2] >= before + 60000)
    assert.deepEqual(events[1], ['videos', 'all', events[0][2]])
  })

  test(`${method} clears the deadline when automatic refresh is disabled`, async () => {
    const { context, events } = await setupCancellation({ deadline: Date.now() + 120000, enabled: false })
    context[method]()
    assert.deepEqual(events, [['all', 'videos', null], ['videos', 'all', null]])
  })
}
