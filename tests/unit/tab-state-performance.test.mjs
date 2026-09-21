import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { createStore } from 'vuex'
import { reconcilePendingTabOrder } from '../../src/renderer/tabs/pendingTabOrder.js'

const source = readFileSync(new URL('../../src/renderer/store/modules/tabs.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export default /m, 'const module = ')
  .replace(/^export /gm, '')

function createTabStore() {
  const module = vm.runInNewContext(`${source}; module`, {
    URL, URLSearchParams,
    packageDetails: { productName: 'OpenTubeX' },
    DEFAULT_VIDEO_ZOOM: 1,
    formatTabTitle: title => title,
    reconcilePendingTabOrder,
  })
  return createStore(module)
}

function snapshot(count = 100) {
  return {
    tabs: Array.from({ length: count }, (_, index) => ({
      id: `tab-${index}`, title: 'History', loadState: 'loaded',
      route: { path: '/history', fullPath: '/history' }
    })),
    groups: [{ id: 'group', name: 'Research' }],
    closedTabs: [{ id: 'closed', route: { path: '/home' }, title: 'Home' }],
  }
}

test('metadata updates preserve unrelated tab objects and collections', () => {
  const store = createTabStore()
  const payload = snapshot()
  store.commit('setTabsState', payload)
  const before = store.getters.getTabs.slice()
  const collections = [store.state.containerIds, store.state.groups, store.state.closedTabs]
  const next = structuredClone(payload)
  next.tabs[0].isLoading = true
  store.commit('setTabsState', next)
  assert.notEqual(store.getters.getTabs[0], before[0])
  for (let index = 1; index < before.length; index++) assert.equal(store.getters.getTabs[index], before[index])
  assert.equal(store.getters.getTabs[0].route, before[0].route)
  assert.equal(store.getters.getTabs[0].history, before[0].history)
  assert.equal(store.state.containerIds, collections[0])
  assert.equal(store.state.groups, collections[1])
  assert.equal(store.state.closedTabs, collections[2])
  const tabs = store.getters.getTabs
  store.commit('setTabsState', structuredClone(next))
  assert.equal(store.getters.getTabs, tabs, 'an unchanged snapshot does not invalidate the tab list')
})

test('tab ID lookup indexes once and follows additions, removals and navigation', () => {
  const store = createTabStore()
  const payload = snapshot()
  let reads = 0
  store.commit('setTabsState', payload)
  for (const tab of store.state.tabs) {
    const id = tab.id
    Object.defineProperty(tab, 'id', { enumerable: true, get() { reads++; return id } })
  }
  reads = 0
  for (let index = 0; index < 100; index++) assert.equal(store.getters.getTabById(`tab-${index}`).title, 'History')
  assert.ok(reads <= 100, `expected at most 100 ID reads, got ${reads}`)
  store.commit('setTabNavigation', { tabId: 'tab-0', route: { path: '/home' }, history: [], historyIndex: 0 })
  assert.equal(store.getters.getTabById('tab-0').route.path, '/home')
  store.commit('setTabsState', { tabs: [{ ...snapshot(1).tabs[0], id: 'new' }] })
  assert.equal(store.getters.getTabById('tab-0'), null)
  assert.equal(store.getters.getTabById('new').id, 'new')
})

test('stable snapshots retain local navigation and acknowledge optimistic reorders', () => {
  const store = createTabStore()
  const payload = snapshot(2)
  store.commit('setTabsState', payload)
  store.commit('setTabNavigation', { tabId: 'tab-0', route: { path: '/home' }, history: [{ route: { path: '/home' } }], historyIndex: 0 })
  store.commit('reorderTabsOptimistically', { tabIds: ['tab-1', 'tab-0'], requestId: 'reorder' })
  store.commit('setTabsState', structuredClone(payload))
  assert.equal(store.getters.getTabs[0].id, 'tab-1')
  assert.equal(store.getters.getTabById('tab-0').route.path, '/home')
  store.commit('setTabsState', { ...payload, tabs: payload.tabs.toReversed(), reorderRequestId: 'reorder' })
  assert.equal(store.state.pendingTabOrder, null)
  const remote = structuredClone(payload)
  remote.tabs[0].syncedNavigationRevision = 1
  store.commit('setTabsState', remote)
  assert.equal(store.getters.getTabById('tab-0').route.path, '/history')
})
