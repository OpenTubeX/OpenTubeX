import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activateCapacitorTab,
  addCapacitorTab,
  closeCapacitorTab,
  createCapacitorTab,
  moveCapacitorTab,
  restoreClosedCapacitorTab,
  restoreCapacitorTabSession,
  setCapacitorTabPinned,
  toRuntimeTabState
} from '../../src/renderer/tabs/capacitorTabState.js'

const HOME_ROUTE = { path: '/home', fullPath: '/home' }
const WATCH_ROUTE = { path: '/watch/video', fullPath: '/watch/video' }

test('seeds a Capacitor tab session from the current route', () => {
  const session = restoreCapacitorTabSession(null, WATCH_ROUTE, () => 'tab-1')

  assert.equal(session.activeTabId, 'tab-1')
  assert.equal(session.tabs.length, 1)
  assert.equal(session.tabs[0].route.fullPath, '/watch/video')
  assert.deepEqual(session.tabs[0].history.map(entry => entry.route.fullPath), ['/watch/video'])
})

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

test('maps the active Capacitor tab into the existing runtime tab shape', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video', 'tab-2'))

  const state = toRuntimeTabState(session)

  assert.equal(state.activeTabId, 'tab-2')
  assert.equal(state.presentedTabId, 'tab-2')
  assert.equal(state.tabs[0].isActive, false)
  assert.equal(state.tabs[1].isActive, true)
  assert.equal(state.tabs[1].loadState, 'loaded')
  assert.equal(state.tabs[1].syncedNavigationRevision, session.selectionRevision)
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

test('restores closed Capacitor tabs in last-closed-first order and no-ops when empty', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-1')
  session = addCapacitorTab(session, createCapacitorTab(WATCH_ROUTE, 'Video A', 'tab-2'))
  session = addCapacitorTab(session, createCapacitorTab({ path: '/watch/b', fullPath: '/watch/b' }, 'Video B', 'tab-3'))
  session = closeCapacitorTab(session, 'tab-2', HOME_ROUTE)
  session = closeCapacitorTab(session, 'tab-3', HOME_ROUTE)

  session = restoreClosedCapacitorTab(session, () => 'restored-b')
  assert.equal(session.tabs.at(-1).title, 'Video B')
  session = restoreClosedCapacitorTab(session, () => 'restored-a')
  assert.equal(session.tabs.at(-1).title, 'Video A')

  assert.equal(restoreClosedCapacitorTab(session), session)
})

test('persists at most ten closed Capacitor tabs and exposes newest first at runtime', () => {
  let session = restoreCapacitorTabSession(null, HOME_ROUTE, () => 'tab-home')

  for (let index = 0; index < 12; index++) {
    const id = `tab-${index}`
    session = addCapacitorTab(session, createCapacitorTab({
      path: `/watch/${index}`,
      fullPath: `/watch/${index}`
    }, `Video ${index}`, id))
    session = closeCapacitorTab(session, id, HOME_ROUTE)
  }

  assert.equal(session.closedTabs.length, 10)
  assert.deepEqual(session.closedTabs.map(tab => tab.title), [
    'Video 2', 'Video 3', 'Video 4', 'Video 5', 'Video 6',
    'Video 7', 'Video 8', 'Video 9', 'Video 10', 'Video 11'
  ])

  const restored = restoreCapacitorTabSession(session, HOME_ROUTE)
  assert.deepEqual(restored.closedTabs.map(tab => tab.title), session.closedTabs.map(tab => tab.title))
  assert.equal(toRuntimeTabState(restored).closedTabs[0].title, 'Video 11')
})

test('does not retain the synthetic landing tab created when the final tab closes', () => {
  let session = restoreCapacitorTabSession(null, WATCH_ROUTE, () => 'tab-1')
  session = closeCapacitorTab(session, 'tab-1', HOME_ROUTE)

  assert.deepEqual(session.closedTabs, [])
  assert.equal(session.tabs[0].route.fullPath, '/home')
})
