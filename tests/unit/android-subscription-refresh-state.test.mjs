import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const start = source.indexOf('async function synchronizeSubscriptionRefreshInProgress()')
const synchronize = source.slice(start, source.indexOf('\n/**', start))

function setup(state, hidden = false) {
  const shown = []
  const timers = new Map()
  const calls = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } },
    navigator: { locks: { query() { assert.fail('Android must use native ownership') } } },
    getAndroidSubscriptionRefreshState: async () => state,
    applySubscriptionAutoRefreshState: value => { shown.push({ ...value }) },
    isAppHidden: () => hidden,
    setTimeout: callback => { const id = Symbol(); timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
    androidSubscriptionRefreshStateTimer: null,
    androidExternalRefreshProgress: null,
    androidSubscriptionRefreshStateVersion: 0,
    subscriptionAutoRefreshTabs: ['videos', 'shorts', 'live', 'posts'],
    notifySubscriptionChannelRefreshed: () => {},
    subscriptionCacheReady: { value: true },
    reconcileAndroidSubscriptionRefreshResults: async () => { calls.push('import') },
    store: { dispatch: async action => { calls.push(action) } },
  })
  vm.runInContext(synchronize, context)
  return { shown, timers, calls, synchronize: () => context.synchronizeSubscriptionRefreshInProgress() }
}

test('reopening Android follows native progress and imports videos before the worker finishes', async () => {
  const state = { inProgress: true, percentage: 42, tab: 'shorts', ownedByRenderer: false }
  const app = setup(state)
  await app.synchronize()
  assert.equal(app.shown[0].inProgress, true, 'a moving native refresh must be visible in the reopened app')
  assert.equal(app.shown[0].percentage, 42)
  assert.equal(app.shown[0].tab, 'shorts')
  assert.deepEqual(app.calls, ['import'])
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
  assert.deepEqual(app.calls, ['import', 'import', 'import'])
})

test('retained renderer cache writes become visible during refresh and after completion', async () => {
  const state = { inProgress: true, percentage: 42, tab: 'videos', ownedByRenderer: false, rendererActive: true }
  const app = setup(state)
  await app.synchronize()
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions'])
  await app.synchronize()
  assert.deepEqual(app.calls, ['import', 'grabAllSubscriptions', 'import'])
  state.percentage = 50
  await app.synchronize()
  assert.equal(app.calls.at(-1), 'grabAllSubscriptions')
  state.inProgress = false
  state.rendererActive = false
  await app.synchronize()
  assert.equal(app.calls.at(-1), 'grabAllSubscriptions')
  assert.equal(app.shown.at(-1).inProgress, false)
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

test('cancelling native work from a reopened renderer postpones its overdue refresh', async () => {
  const events = []
  const window = new EventTarget()
  const calls = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } }, window, CustomEvent,
    cancelSubscriptionRefresh() {}, cancelAndroidSubscriptionRefresh: () => calls.push('cancel'),
    activeRefresh: null, cancelCount: 1,
    store: { getters: { getSubscriptionFeedRefreshInProgress: true, getSubscriptionFeedRefreshTab: 'videos', getActiveProfile: { _id: 'all' } } },
    localStorage: { setItem() {} },
    SUBSCRIPTION_REFRESH_CANCELLED_EVENT: 'cancelled', SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY: 'cancel',
    activeSubscriptionProfileId: { value: 'all' }, subscriptionAutoRefreshTabs: ['videos'],
    cancelledSubscriptionAutoRefreshKeys: new Set(),
    isSubscriptionTabAutoRefreshEnabled: () => true,
    getSubscriptionTabAutoRefreshInterval: () => 60000,
    setStoredSubscriptionTabNextAutoRefreshTimestamp: (...args) => events.push(args),
    scheduleSubscriptionTabAutoRefresh: (...args) => events.push(args),
  })
  const subscriptions = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
  const cancellationStart = subscriptions.indexOf('export function requestSubscriptionRefreshCancellation()')
  vm.runInContext(subscriptions.slice(cancellationStart, subscriptions.indexOf('\n/**', cancellationStart)).replace('export ', ''), context)
  const handlerStart = source.indexOf('function handleSubscriptionRefreshCancelled(event)')
  vm.runInContext(source.slice(handlerStart, source.indexOf('\n/**', handlerStart)), context)
  window.addEventListener('cancelled', event => context.handleSubscriptionRefreshCancelled(event))
  const before = Date.now()
  context.requestSubscriptionRefreshCancellation()
  assert.deepEqual(calls, ['cancel'])
  assert.equal(events.length, 2)
  assert.deepEqual(events[0].slice(0, 2), ['all', 'videos'])
  assert.ok(events[0][2] >= before + 60000)
  assert.deepEqual(events[1], ['videos', 'all', events[0][2]])
})
