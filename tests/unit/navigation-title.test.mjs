import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, watch } from 'vue'
import { createMemoryHistory, createRouter, START_LOCATION } from 'vue-router'
import { createStore } from 'vuex'
import { getFixedInternalRouteTitle } from '../../src/internalRoutes.js'
import { reconcilePendingTabOrder } from '../../src/renderer/tabs/pendingTabOrder.js'
import { tabLifecycleService } from '../../src/renderer/tabs/TabLifecycleService.js'

const storeSource = readFileSync(new URL('../../src/renderer/store/modules/tabs.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export default /m, 'const module = ')
  .replace(/^export /gm, '')
const navigationSource = readFileSync(new URL('../../src/renderer/tabs/TabNavigationService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export default .*$/gm, '')
  .replace(/^export /gm, '')
const contextSource = readFileSync(new URL('../../src/renderer/tabs/TabContext.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

function mountBrowsingTitle(t, store, navigation, fullPath = '/channel/UC-test') {
  const route = reactive(navigation.resolve(fullPath))
  const unmount = []
  const scope = effectScope()
  const setTitle = scope.run(() => vm.runInNewContext(`${contextSource}; useTabTitle()`, {
    computed, watch,
    inject: key => key === 'tabRoute' ? route : key.description === 'logical-tab-id' ? 'tab' : null,
    onBeforeUnmount: callback => unmount.push(callback),
    process: { env: { IS_ELECTRON: true } },
    store, getTabNavigationService: () => navigation,
  }))
  t.after(() => {
    unmount.forEach(callback => callback())
    scope.stop()
  })
  return { route, setTitle }
}

function setup() {
  const packageDetails = { productName: 'OpenTubeX' }
  const { module, cloneRoute, normalizeRoute } = vm.runInNewContext(`${storeSource}; ({ module, cloneRoute, normalizeRoute })`, {
    URL, URLSearchParams, packageDetails, DEFAULT_VIDEO_ZOOM: 1,
    formatTabTitle: title => title, reconcilePendingTabOrder,
  })
  const store = createStore(module)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/channel/:id', name: 'channel', component: {} },
      { path: '/watch/:id', name: 'watch', component: {} },
      { path: '/external-media', component: {}, meta: { title: 'Watch', hasDynamicTitle: true } },
      { path: '/subscriptions', name: 'subscriptions', component: {}, meta: { title: 'Subscriptions' } },
    ],
  })
  const Service = vm.runInNewContext(`${navigationSource}; TabNavigationService`, {
    cloneRoute, normalizeRoute, packageDetails, tabLifecycleService, nextTick, START_LOCATION,
    getFixedInternalRouteTitle, translateWindowTitle: title => title,
    runPendingViewTransition: run => run(),
    window: { setTimeout: () => 0, clearTimeout() {} },
  })
  const navigation = new Service(router, store)
  store.commit('setTabsState', { tabs: [{
    id: 'tab', title: 'Test channel', loadState: 'loaded',
    route: { path: '/channel/UC-test', fullPath: '/channel/UC-test' },
  }] })
  return { store, navigation, tab: () => store.getters.getTabById('tab') }
}

test('minimizing Watch restores the loaded channel name without requiring its view to reload', async () => {
  const { navigation, tab } = setup()
  await navigation.push('tab', { path: '/watch/video', state: { tabTitle: 'Test video' } })
  await navigation.back('tab')
  assert.equal(tab().route.path, '/channel/UC-test')
  assert.equal(tab().contentTitle, 'Test channel')
  assert.equal(tab().history[tab().historyIndex].title, 'Test channel')
  await navigation.forward('tab')
  assert.equal(tab().contentTitle, 'Test video')
  await navigation.back('tab')
  assert.equal(tab().contentTitle, 'Test channel')
})

test('history restores an unresolved Watch title without marking its metadata resolved', async () => {
  const { navigation, tab } = setup()
  await navigation.push('tab', { path: '/watch/video', state: { tabTitle: 'Test video' } })
  await navigation.push('tab', '/subscriptions')
  // Model an unresolved entry restored from a saved session.
  tab().history[1].title = '/watch/video'
  tab().history[1].titlePending = true
  await navigation.back('tab')
  assert.equal(tab().contentTitle, '/watch/video')
  assert.equal(tab().history[1].titlePending, true)
  await navigation.back('tab')
  assert.equal(tab().contentTitle, 'Test channel')
  assert.equal(tab().history.length, 2, 'the unresolved Watch entry is still discarded on exit')
})

test('fresh channel navigation uses its own placeholder and can publish a new name', async () => {
  const { navigation, tab } = setup()
  await navigation.push('tab', '/channel/UC-other')
  assert.equal(tab().contentTitle, '/channel/UC-other')
  navigation.setTitle('tab', 'Another channel')
  await navigation.back('tab')
  assert.equal(tab().contentTitle, 'Test channel')
  await navigation.forward('tab')
  assert.equal(tab().contentTitle, 'Another channel')
})

test('a channel finishing behind Watch cannot replace the video tab title or history', async t => {
  const { store, navigation, tab } = setup()
  const channel = mountBrowsingTitle(t, store, navigation)
  await navigation.push('tab', { path: '/watch/video', state: { tabTitle: 'Test video' } })
  channel.setTitle('Test channel')
  assert.equal(tab().contentTitle, 'Test video')
  assert.equal(tab().history[tab().historyIndex].title, 'Test video')
  await navigation.push('tab', '/channel/UC-test')
  assert.equal(tab().contentTitle, 'Test channel', 'the late channel title is available when reopened')
  await navigation.back('tab')
  assert.equal(tab().contentTitle, 'Test video', 'returning to the video preserves its history title')
})

test('reopening the retained channel restores its loaded name instead of its URL', async t => {
  const { store, navigation, tab } = setup()
  const channel = mountBrowsingTitle(t, store, navigation)
  channel.setTitle('Test channel')
  await navigation.push('tab', { path: '/watch/video', state: { tabTitle: 'Test video' } })
  await navigation.push('tab', '/channel/UC-test')
  assert.equal(tab().contentTitle, 'Test channel')
  assert.equal(tab().history[tab().historyIndex].title, 'Test channel')
})

test('an inactive tab still receives the title for its current browsing page', t => {
  const { store, navigation, tab } = setup()
  const channel = mountBrowsingTitle(t, store, navigation)
  assert.notEqual(store.getters.getPresentedTabId, 'tab')
  channel.setTitle('Updated channel name')
  assert.equal(tab().contentTitle, 'Updated channel name')
})

test('a retained channel title cannot carry over to a different channel', async t => {
  const { store, navigation, tab } = setup()
  const channel = mountBrowsingTitle(t, store, navigation)
  channel.setTitle('Test channel')
  await navigation.push('tab', { path: '/watch/video', state: { tabTitle: 'Test video' } })
  await navigation.push('tab', '/channel/UC-other')
  Object.assign(channel.route, navigation.resolve('/channel/UC-other'))
  await nextTick()
  assert.equal(tab().contentTitle, '/channel/UC-other', 'the new channel waits for its own metadata')
  channel.setTitle('Another channel')
  assert.equal(tab().contentTitle, 'Another channel')
})

for (const mode of ['push', 'replace']) {
  test(`${mode} to the same restored external URL preserves its resolved title and history`, async () => {
    const { store, navigation } = setup()
    const query = { url: 'https://www.twitch.tv/videos/123456789' }
    // The main process serializes saved tab routes with URLSearchParams,
    // which escapes ':' and '/' differently from Vue Router.
    const route = { path: '/external-media', query, fullPath: `/external-media?${new URLSearchParams(query)}` }
    store.commit('setTabsState', { tabs: [{ id: 'restored', route, title: 'A Twitch broadcast', loadState: 'loaded' }] })
    await navigation[mode]('restored', { path: '/external-media', query })
    assert.equal(store.getters.getTabById('restored').contentTitle, 'A Twitch broadcast')
    assert.equal(store.getters.getTabById('restored').history.length, 1)

    await navigation.push('restored', { path: '/external-media', query: { url: 'https://www.twitch.tv/other' } })
    const changed = store.getters.getTabById('restored')
    assert.equal(changed.contentTitle, changed.route.fullPath, 'different media still clears the old title')
    assert.equal(changed.history.length, 2)
  })
}

test('a restored external media page can publish its title despite different URL encodings', t => {
  const { store, navigation } = setup()
  const query = { url: 'https://www.twitch.tv/videos/123456789' }
  const fullPath = `/external-media?${new URLSearchParams(query)}`
  store.commit('setTabsState', { tabs: [] })
  store.commit('setTabsState', { tabs: [{
    id: 'tab', route: { path: '/external-media', query, fullPath },
    title: fullPath, loadState: 'loaded'
  }] })
  const media = mountBrowsingTitle(t, store, navigation, fullPath)
  media.setTitle('A Twitch broadcast')
  assert.equal(store.getters.getTabById('tab').contentTitle, 'A Twitch broadcast')
})
