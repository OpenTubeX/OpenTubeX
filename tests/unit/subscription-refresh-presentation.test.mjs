import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, watch } from 'vue'
import { getSubscriptionsForFeed } from '../../src/renderer/helpers/subscription-channels.js'

const source = (await readFile(new URL('../../src/renderer/composables/useSubscriptionChannelUpdates.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace(/^export /gm, '')

function setup(channelCount, presented = true, feed = 'videos', isLargeFeed = undefined, publishDuration = 0) {
  const window = new EventTarget()
  const state = reactive({
    getSubscriptionFeedRefreshInProgress: true,
    getSubscriptionFeedRefreshTab: feed,
    getActiveProfile: { subscriptions: Array.from({ length: channelCount }, (_, index) => ({ id: `UC${index}` })) }
  })
  const visibility = reactive({ value: presented })
  const callbacks = new Map()
  let updates = 0
  let now = 1_000_000
  const scope = effectScope()
  const context = vm.createContext({
    window, computed, nextTick, reactive, watch, store: { getters: state }, getSubscriptionsForFeed,
    SUBSCRIPTION_REFRESH_CHANNEL_EVENT: 'channel',
    useTabContext: () => ({ isTabPresented: visibility }),
    onActivated() {}, onDeactivated() {}, onBeforeUnmount() {},
    Date: { now: () => now },
    setTimeout: (callback, delay) => { const id = callbacks.size + 1; callbacks.set(id, { callback, delay }); return id },
    clearTimeout: id => callbacks.delete(id)
  })
  vm.runInContext(source, context)
  scope.run(() => context.useSubscriptionChannelUpdates(feed, () => { updates++; now += publishDuration }, isLargeFeed))
  return {
    state, visibility, scope,
    get updates() { return updates },
    async channel() { window.dispatchEvent(new CustomEvent('channel', { detail: { tab: feed } })); await nextTick() },
    get delays() { return [...callbacks.values()].map(({ delay }) => delay) },
    advance(ms) { now += ms },
    async flush() {
      const pending = [...callbacks]
      callbacks.clear()
      for (const [, { callback }] of pending) await callback()
    }
  }
}

for (const feed of ['videos', 'shorts', 'live', 'posts']) {
  test(`a large ${feed} refresh publishes its first channel immediately and later ones in batches`, async () => {
    const app = setup(40, true, feed)
    try {
      await app.channel()
      assert.deepEqual(app.delays, [0])
      await app.flush()
      assert.equal(app.updates, 1)

      app.advance(500)
      for (let index = 0; index < 10; index++) await app.channel()
      assert.deepEqual(app.delays, [1500])
      app.advance(1500)
      await app.flush()
      assert.equal(app.updates, 2)
    } finally { app.scope.stop() }
  })

  test(`a large ${feed} refresh publishes pending results promptly when completed or cancelled`, async () => {
    const app = setup(40, true, feed)
    try {
      await app.channel()
      await app.flush()
      app.advance(50)
      await app.channel()
      assert.deepEqual(app.delays, [1950])
      app.state.getSubscriptionFeedRefreshInProgress = false
      await nextTick()
      assert.deepEqual(app.delays, [50])
      await app.flush()
      assert.equal(app.updates, 2)
    } finally { app.scope.stop() }
  })
}

test('slow publications lengthen the batch interval of a large refresh', async () => {
  const app = setup(40, true, 'videos', undefined, 500)
  try {
    await app.channel()
    await app.flush()
    await app.channel()
    assert.deepEqual(app.delays, [5000])
  } finally { app.scope.stop() }
})

test('a new large refresh publishes its first channel immediately after a recent publication', async () => {
  const app = setup(40)
  try {
    await app.channel()
    await app.flush()
    app.state.getSubscriptionFeedRefreshInProgress = false
    await nextTick()
    app.state.getSubscriptionFeedRefreshInProgress = true
    await nextTick()
    await app.channel()
    assert.deepEqual(app.delays, [0])
  } finally { app.scope.stop() }
})

test('a large cached feed batches a refresh of few channels', async () => {
  const app = setup(3, true, 'videos', () => true)
  try {
    await app.channel()
    await app.flush()
    await app.channel()
    assert.deepEqual(app.delays, [2000])
  } finally { app.scope.stop() }
})

test('small refreshes still show incremental results and coalesce pending responses', async () => {
  const app = setup(3)
  try {
    await app.channel()
    await app.channel()
    await app.flush()
    assert.equal(app.updates, 1)
    await app.channel()
    await app.flush()
    assert.equal(app.updates, 2)
  } finally { app.scope.stop() }
})

test('channels excluded from this feed do not batch a small refresh', async () => {
  const app = setup(40)
  try {
    app.state.getActiveProfile.subscriptions.slice(3).forEach(channel => { channel.feedTypes = [] })
    await app.channel()
    await app.flush()
    await app.channel()
    assert.deepEqual(app.delays, [100])
  } finally { app.scope.stop() }
})

test('a completed large refresh keeps hidden feeds idle and publishes on presentation', async () => {
  const app = setup(40, false)
  try {
    await app.channel()
    app.state.getSubscriptionFeedRefreshInProgress = false
    await nextTick()
    await app.flush()
    assert.equal(app.updates, 0)
    app.visibility.value = true
    await nextTick()
    await app.flush()
    assert.equal(app.updates, 1)
  } finally { app.scope.stop() }
})

test('a completed feed publishes pending results while the next feed refreshes', async () => {
  const app = setup(40)
  try {
    await app.channel()
    await app.flush()
    await app.channel()
    assert.equal(app.updates, 1)
    // Consecutive feeds may transition before the callback timer runs.
    app.state.getSubscriptionFeedRefreshInProgress = false
    app.state.getSubscriptionFeedRefreshTab = 'shorts'
    app.state.getSubscriptionFeedRefreshInProgress = true
    await nextTick()
    assert.deepEqual(app.delays, [100])
    await app.flush()
    assert.equal(app.updates, 2)
  } finally { app.scope.stop() }
})
