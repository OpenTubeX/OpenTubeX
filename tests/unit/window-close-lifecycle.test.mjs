import assert from 'node:assert/strict'
import test from 'node:test'

import { attachWindowCloseLifecycle } from '../../src/main/windowCloseLifecycle.js'

function setup(overrides = {}) {
  const listeners = new Map()
  const calls = []
  const window = {
    id: 3,
    on: (event, listener) => listeners.set(event, listener),
    getNormalBounds: () => ({ x: 1, y: 2, width: 900, height: 700 }),
    isMaximized: () => false,
    isFullScreen: () => false,
    close: () => calls.push('close')
  }
  const tabManager = {
    tabs: new Map([['a', {}], ['b', {}]]),
    getSessionDataForWindowClose: () => ({ sessionId: 'session' }),
    _saveSession: async () => calls.push('save'),
    clearSession: async () => calls.push('clear')
  }
  const confirmed = new Set()
  attachWindowCloseLifecycle({
    window,
    tabManager,
    BrowserWindow: { getAllWindows: () => [window] },
    isQuitting: () => false,
    isTrayOnClose: () => false,
    isTrayEnabled: () => false,
    trayClosingWindowIds: new Set(),
    hideWindowToTray: () => {},
    closeConfirmedWindowIds: confirmed,
    closingWindowIds: new Set(),
    confirmCloseApp: async () => false,
    confirmCloseWindowWithMultipleTabs: async () => false,
    keepRefreshingInBackground: () => false,
    confirmQuit: () => calls.push('quit'),
    closedWindows: { remember: data => calls.push(['remember', data]) },
    htmlFullscreenWindowIds: new Set(),
    settings: { _updateBounds: async value => calls.push(['bounds', value]) },
    ...overrides
  })
  return { listeners, calls, window, confirmed }
}

test('closing a confirmed last window saves its session and bounds', async () => {
  const { listeners, calls, confirmed } = setup()
  confirmed.add(3)
  await listeners.get('close')({ preventDefault: () => assert.fail('must close') })
  assert.deepEqual(calls, [
    ['remember', { sessionId: 'session' }],
    'save',
    ['bounds', { x: 1, y: 2, width: 900, height: 700, maximized: false, fullScreen: false }]
  ])
})

test('canceling the last-window prompt keeps the window and session', async () => {
  const { listeners, calls } = setup()
  let prevented = false
  await listeners.get('close')({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.deepEqual(calls, [])
})

test('closing one of several confirmed windows clears its persisted session', async () => {
  const { listeners, calls, confirmed, window } = setup({
    BrowserWindow: { getAllWindows: () => [{ id: 3 }, { id: 4 }] }
  })
  confirmed.add(window.id)
  await listeners.get('close')({ preventDefault: () => assert.fail('must close') })
  assert.equal(calls.includes('clear'), true)
})
