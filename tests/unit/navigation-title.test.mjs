import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick } from 'vue'
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
