import assert from 'node:assert/strict'
import test from 'node:test'
import { getTabHistoryState, normalizeRoute, reconcileTab } from '../../src/renderer/tabs/tabSessionModel.js'

test('tab snapshot reconciliation preserves local navigation until a sync revision changes', () => {
  const incoming = {
    id: 'tab-a',
    title: 'History',
    loadState: 'loaded',
    route: { path: '/history', fullPath: '/history' },
    syncedNavigationRevision: 0,
  }
  const original = reconcileTab(null, incoming, title => title)
  const local = {
    ...original,
    route: normalizeRoute({ path: '/watch', query: { v: 'video' } }),
    history: [{ route: normalizeRoute({ path: '/watch' }), title: 'Current video' }],
    historyIndex: 0,
  }

  const echo = reconcileTab(local, structuredClone(incoming), title => title)
  assert.equal(echo.route.fullPath, '/watch?v=video')
  assert.equal(echo.history, local.history)

  const remote = reconcileTab(local, { ...incoming, syncedNavigationRevision: 1 }, title => title)
  assert.equal(remote.route.fullPath, '/history')
  assert.equal(remote.history[remote.historyIndex].route.fullPath, '/history')
  assert.equal(remote.pendingReloadRoute, null)
})

test('tab history options center the current entry and preserve relative navigation', () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    route: normalizeRoute({ path: `/watch/${index}` }),
    title: `Video ${index}`,
  }))
  const state = getTabHistoryState({ history, historyIndex: 10 }, () => ['fas', 'clapperboard'])
  assert.equal(state.canGoBack, true)
  assert.equal(state.canGoForward, true)
  assert.equal(state.options.length, 15)
  assert.deepEqual(state.options.find(option => option.active), {
    label: 'Video 10', value: 0, active: true, icon: ['fas', 'clapperboard']
  })
  assert.equal(state.options[0].value, 7)
  assert.equal(state.options.at(-1).value, -7)
})
