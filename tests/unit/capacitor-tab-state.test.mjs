import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activateCapacitorTab,
  addCapacitorTab,
  closeCapacitorTab,
  completeCapacitorTabMount,
  createCapacitorTab,
  loadCapacitorTab,
  moveCapacitorTab,
  reloadCapacitorTab,
  restoreClosedCapacitorTab,
  restoreCapacitorTabSession,
  setCapacitorTabPinned,
  toRuntimeTabState,
  unloadCapacitorTab
} from '../../src/renderer/tabs/capacitorTabState.js'

const HOME_ROUTE = { path: '/home', fullPath: '/home' }
const WATCH_ROUTE = { path: '/watch/video', fullPath: '/watch/video' }

test('restores valid tabs and ignores malformed persisted entries', () => {
  const session = restoreCapacitorTabSession({
    activeTabId: 'tab-2',
    selectionRevision: 4,
    tabs: [
      createCapacitorTab(HOME_ROUTE, 'Home', 'tab-1'),
      null,
      createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-2')
    ]
  }, HOME_ROUTE, () => 'fallback')

  assert.deepEqual(session.tabs.map(tab => tab.id), ['tab-1', 'tab-2'])
  assert.equal(session.activeTabId, 'tab-2')
  assert.equal(session.selectionRevision, 4)
  assert.equal(session.tabs[0].loadState, 'mounting')
  assert.equal(session.tabs[0].mountRevision, 1)
  assert.equal(session.tabs[0].isLoading, true)
})

test('restored Capacitor tabs can report a fresh mount failure', () => {
  const persistedTab = createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-1')
  delete persistedTab.loadState
  delete persistedTab.mountRevision
  delete persistedTab.isLoading

  let session = restoreCapacitorTabSession({
    activeTabId: 'tab-1',
    tabs: [persistedTab]
  }, HOME_ROUTE)

  assert.equal(session.tabs[0].loadState, 'mounting')
  assert.equal(session.tabs[0].mountRevision, 1)
  session = completeCapacitorTabMount(session, 'tab-1', 1, false)
  assert.equal(session.tabs[0].loadState, 'unloaded')
})

test('retains complete Capacitor sessions with more than twenty tabs', () => {
  const tabs = Array.from({ length: 43 }, (_, index) => createCapacitorTab({
    path: `/watch/${index}`,
    fullPath: `/watch/${index}`
  }, `Video ${index}`, `tab-${index}`))
  let session = restoreCapacitorTabSession({
    activeTabId: 'tab-42',
    tabs,
  }, HOME_ROUTE)

  assert.equal(session.tabs.length, 43)
  assert.equal(session.activeTabId, 'tab-42')

  session = addCapacitorTab(session, createCapacitorTab(HOME_ROUTE, 'Another tab', 'tab-43'))
  assert.equal(session.tabs.length, 44)

  session = closeCapacitorTab(session, 'tab-43', HOME_ROUTE)
  session = restoreClosedCapacitorTab(session, () => 'tab-restored')
  assert.equal(session.tabs.length, 44)
  assert.equal(session.tabs.at(-1).id, 'tab-restored')
})

test('adds, activates, and closes Capacitor tabs while retaining one tab', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-2'))

  assert.equal(session.activeTabId, 'tab-2')
  assert.equal(session.selectionRevision, 1)

  session = activateCapacitorTab(session, 'tab-1')
  assert.equal(session.activeTabId, 'tab-1')

  session = closeCapacitorTab(session, 'tab-1', HOME_ROUTE)
  assert.equal(session.activeTabId, 'tab-2')
  assert.deepEqual(session.tabs.map(tab => tab.id), ['tab-2'])

  session = closeCapacitorTab(session, 'tab-2', HOME_ROUTE)
  assert.equal(session.tabs.length, 1)
  assert.equal(session.tabs[0].id, 'tab-2')
  assert.equal(session.tabs[0].route.fullPath, '/home')
})

test('loads, unloads, and completes Capacitor tab mounts', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  session = completeCapacitorTabMount(session, 'tab-1', 1)
  const loadedTab = session.tabs[0]

  assert.equal(loadedTab.loadState, 'loaded')
  assert.equal(loadedTab.isLoading, false)

  loadedTab.isLoading = true
  loadedTab.isPlaying = true
  session = unloadCapacitorTab(session, 'tab-1')

  assert.equal(session.tabs[0].loadState, 'unloaded')
  assert.equal(session.tabs[0].isLoading, false)
  assert.equal(session.tabs[0].isPlaying, false)
  assert.equal(session.tabs[0].refreshKey, 1)

  session = loadCapacitorTab(session, 'tab-1')

  assert.equal(session.tabs[0].loadState, 'mounting')
  assert.equal(session.tabs[0].mountRevision, 2)
  assert.equal(session.tabs[0].isLoading, true)

  session = completeCapacitorTabMount(session, 'tab-1', 2)
  assert.equal(session.tabs[0].loadState, 'loaded')
  assert.equal(session.tabs[0].isLoading, false)
})

test('ignores stale mount completions and unloads a tab when mounting fails', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  session = reloadCapacitorTab(session, 'tab-1')

  const staleCompletion = completeCapacitorTabMount(session, 'tab-1', 1)
  assert.equal(staleCompletion, session)
  assert.equal(staleCompletion.tabs[0].loadState, 'mounting')

  session = completeCapacitorTabMount(session, 'tab-1', 2, false)
  assert.equal(session.tabs[0].loadState, 'unloaded')
  assert.equal(session.tabs[0].isLoading, false)
})

test('reloads a Capacitor tab with a fresh mount and refresh key', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  session = completeCapacitorTabMount(session, 'tab-1', 1)
  session.tabs[0].isPlaying = true
  session.tabs[0].pendingReloadRoute = {
    path: '/watch/video',
    fullPath: '/watch/video?oneTimeTimestamp=42'
  }

  session = reloadCapacitorTab(session, 'tab-1')

  assert.equal(session.tabs[0].loadState, 'mounting')
  assert.equal(session.tabs[0].mountRevision, 2)
  assert.equal(session.tabs[0].refreshKey, 1)
  assert.equal(session.tabs[0].isLoading, true)
  assert.equal(session.tabs[0].isPlaying, false)
  assert.equal(
    toRuntimeTabState(session).tabs[0].pendingReloadRoute.fullPath,
    '/watch/video?oneTimeTimestamp=42'
  )
})

test('restores unloaded Capacitor tabs from persisted sessions', () => {
  const unloadedTab = createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-1')
  unloadedTab.isUnloaded = true
  delete unloadedTab.loadState

  const session = restoreCapacitorTabSession({
    activeTabId: 'tab-1',
    tabs: [unloadedTab]
  }, HOME_ROUTE)

  assert.equal(session.tabs[0].loadState, 'unloaded')
  assert.equal(toRuntimeTabState(session).tabs[0].isUnloaded, true)
})

test('pins Capacitor tabs first and only reorders within their pin group', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-2'))
  session = addCapacitorTab(session, createCapacitorTab(HOME_ROUTE, 'Home 2', 'tab-3'))

  session = setCapacitorTabPinned(session, 'tab-2', true)
  assert.deepEqual(session.tabs.map(tab => tab.id), ['tab-2', 'tab-1', 'tab-3'])
  assert.equal(session.tabs[0].isPinned, true)

  session = moveCapacitorTab(session, 'tab-3', 0)
  assert.deepEqual(session.tabs.map(tab => tab.id), ['tab-2', 'tab-3', 'tab-1'])

  const restored = restoreCapacitorTabSession(session, HOME_ROUTE)
  assert.equal(restored.tabs[0].isPinned, true)
  assert.equal(toRuntimeTabState(restored).tabs[0].isPinned, true)
})

test('retains closed Capacitor tabs and restores the newest one with its history', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  const videoTab = createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-2')
  videoTab.history.push({
    route: { path: '/watch/next', fullPath: '/watch/next' },
    title: 'Next video',
    scroll: { left: 0, top: 240 }
  })
  videoTab.route = videoTab.history[1].route
  videoTab.title = videoTab.history[1].title
  videoTab.historyIndex = 1
  session = addCapacitorTab(session, videoTab)

  session = closeCapacitorTab(session, 'tab-2', HOME_ROUTE)
  assert.equal(session.closedTabs.length, 1)
  assert.equal(session.closedTabs[0].route.fullPath, '/watch/next')
  assert.deepEqual(
    session.closedTabs[0].history.map(entry => entry.route.fullPath),
    ['/watch/video', '/watch/next']
  )

  session = restoreClosedCapacitorTab(session, () => 'tab-restored')
  assert.equal(session.closedTabs.length, 0)
  assert.equal(session.activeTabId, 'tab-restored')
  assert.equal(session.tabs.at(-1).id, 'tab-restored')
  assert.equal(session.tabs.at(-1).route.fullPath, '/watch/next')
  assert.equal(session.tabs.at(-1).historyIndex, 1)
})

test('converts a Capacitor session on Android WebViews without Array.toReversed', () => {
  const toReversed = Array.prototype.toReversed
  Array.prototype.toReversed = undefined

  try {
    let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-home')
    session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-video'))
    session = closeCapacitorTab(session, 'tab-video', HOME_ROUTE)

    assert.equal(toRuntimeTabState(session).closedTabs[0].title, 'Video')
  } finally {
    Array.prototype.toReversed = toReversed
  }
})
