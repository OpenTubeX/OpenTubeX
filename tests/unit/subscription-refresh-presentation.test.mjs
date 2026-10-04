import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, watch } from 'vue'
import { getSubscriptionsForFeed } from '../../src/renderer/helpers/subscription-channels.js'

const source = (await readFile(new URL('../../src/renderer/composables/useSubscriptionChannelUpdates.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace(/^export /gm, '')

function setup(channelCount, presented = true, feed = 'videos') {
  const window = new EventTarget()
  const state = reactive({
    getSubscriptionFeedRefreshInProgress: true,
    getSubscriptionFeedRefreshTab: feed,
    getActiveProfile: { subscriptions: Array.from({ length: channelCount }, (_, index) => ({ id: `UC${index}` })) }
  })
  const visibility = reactive({ value: presented })
  const callbacks = new Map()
  let updates = 0
  const scope = effectScope()
  const context = vm.createContext({
    window, computed, reactive, watch, store: { getters: state }, getSubscriptionsForFeed,
    SUBSCRIPTION_REFRESH_CHANNEL_EVENT: 'channel',
    useTabContext: () => ({ isTabPresented: visibility }),
    onActivated() {}, onDeactivated() {}, onBeforeUnmount() {},
    Date, setTimeout: callback => { const id = callbacks.size + 1; callbacks.set(id, callback); return id },
    clearTimeout: id => callbacks.delete(id)
  })
  vm.runInContext(source, context)
  scope.run(() => context.useSubscriptionChannelUpdates(feed, () => { updates++ }))
  return {
    state, visibility, scope,
    get updates() { return updates },
    async channel() { window.dispatchEvent(new CustomEvent('channel', { detail: { tab: feed } })); await nextTick() },
    flush() { for (const [id, callback] of callbacks) { callbacks.delete(id); callback() } }
  }
}

for (const feed of ['videos', 'shorts', 'live', 'posts']) {
  test(`a large ${feed} refresh publishes once when completed or cancelled`, async () => {
    const app = setup(40, true, feed)
    try {
      for (let index = 0; index < 40; index++) { await app.channel(); app.flush() }
      assert.equal(app.updates, 0)
      app.state.getSubscriptionFeedRefreshInProgress = false
      await nextTick()
      app.flush()
      assert.equal(app.updates, 1)
    } finally { app.scope.stop() }
  })
}

test('small refreshes still show incremental results and coalesce pending responses', async () => {
  const app = setup(3)
  try {
    await app.channel()
    await app.channel()
    app.flush()
    assert.equal(app.updates, 1)
    await app.channel()
    app.flush()
    assert.equal(app.updates, 2)
  } finally { app.scope.stop() }
})

test('channels excluded from this feed do not defer a small refresh', async () => {
  const app = setup(40)
  try {
    app.state.getActiveProfile.subscriptions.slice(3).forEach(channel => { channel.feedTypes = [] })
    await app.channel()
    app.flush()
    assert.equal(app.updates, 1)
  } finally { app.scope.stop() }
})

test('a completed large refresh keeps hidden feeds idle and publishes on presentation', async () => {
  const app = setup(40, false)
  try {
    await app.channel()
    app.state.getSubscriptionFeedRefreshInProgress = false
    await nextTick()
    app.flush()
    assert.equal(app.updates, 0)
    app.visibility.value = true
    await nextTick()
    app.flush()
    assert.equal(app.updates, 1)
  } finally { app.scope.stop() }
})

test('a completed feed publishes pending results while the next feed refreshes', async () => {
  const app = setup(40)
  try {
    await app.channel()
    app.flush()
    assert.equal(app.updates, 0)
    // Consecutive feeds may transition before the callback timer runs.
    app.state.getSubscriptionFeedRefreshInProgress = false
    app.state.getSubscriptionFeedRefreshTab = 'shorts'
    app.state.getSubscriptionFeedRefreshInProgress = true
    await nextTick()
    app.flush()
    assert.equal(app.updates, 1)
  } finally { app.scope.stop() }
})
