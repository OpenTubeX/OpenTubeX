import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import test from 'node:test'

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
        export const BrowserWindow = {}, ipcMain = {}, nativeImage = {}, shell = {};
        export const app = { getName: () => 'OpenTubeX' };
      `) }
    }
    if (specifier.endsWith('/datastores/handlers/base.js')) {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
        export const settings = { _findOne: async () => null };
        export const tabSession = {
          saved: null,
          cleared: [],
          async save(id, data) { this.saved = structuredClone(data); },
          async clear(id) { this.cleared.push(id); }
        };
      `) }
    }
    return nextResolve(specifier, context)
  }
})
const { TabManager } = await import('../../src/main/tabs/TabManager.js')
const { tabSession } = await import('../../src/datastores/handlers/base.js')
const { tabPreviewStorage } = await import('../../src/main/tabs/TabPreviewStorage.js')
const { setupTabsIPC } = await import('../../src/main/tabs/tabIpc.js')
const { BrowserWindow, ipcMain } = await import('electron')
const { IpcChannels } = await import('../../src/constants.js')
hooks.deregister()
const { createTabAvatarFileName } = await import('../../src/main/tabs/tabPreviewCache.js')

function createManager(t, sessionId, windowId = 1) {
  const window = new EventEmitter()
  window.id = windowId
  window.webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setWindowOpenHandler() {},
    send() {}
  })
  window.setTitle = () => {}
  window.getBounds = () => ({ x: 0, y: 0, width: 1200, height: 800 })
  window.getNormalBounds = window.getBounds
  window.isDestroyed = () => false
  window.isMaximized = () => false
  window.isFullScreen = () => false
  const manager = new TabManager(window, 'app://bundle/index.html', undefined, sessionId)
  manager._tabPreviewsEnabled = false
  t.after(() => {
    window.isDestroyed = () => true
    window.emit('closed')
  })
  return manager
}

async function setupIpc(t, managers, options = {}) {
  const handlers = new Map()
  ipcMain.on = ipcMain.handle = (channel, handler) => {
    assert.equal(handlers.has(channel), false, 'register each channel once')
    handlers.set(channel, handler)
  }
  BrowserWindow.fromWebContents = sender => managers
    .find(manager => manager.browserWindow.webContents === sender)?.browserWindow
  t.after(() => {
    delete ipcMain.on
    delete ipcMain.handle
    delete BrowserWindow.fromWebContents
  })
  await setupTabsIPC(options)
  return handlers
}

function session(count) {
  return {
    tabs: Array.from({ length: count }, (_, index) => ({
      id: `tab-${index}`,
      url: 'app://bundle/index.html#/history',
      title: `History ${index}`,
      isUnloaded: false
    })),
    activeTabId: `tab-${count - 1}`
  }
}

test('closed window snapshots restore tab state and groups without a disk save', async t => {
  const manager = createManager(t)
  const saved = session(3)
  saved.tabs[0].isPinned = true
  saved.tabs[1].isUnloaded = true
  saved.tabs[1].color = 'blue'
  saved.tabs[1].skipSilence = true
  saved.groups = [{ id: 'research', name: 'Research', color: 'blue' }]
  saved.tabs[1].groupId = 'research'
  await manager.restoreFromData(saved, { restoreTabLoadState: true })
  const snapshot = structuredClone(manager.getSessionDataForWindowClose())
  assert.equal(snapshot.sessionId, manager.sessionId)
  assert.deepEqual(snapshot.bounds, { x: 0, y: 0, width: 1200, height: 800, maximized: false, fullScreen: false })
  const reopened = createManager(t, snapshot.sessionId)
  await reopened.restoreFromData(snapshot, { restoreTabLoadState: true })
  const restored = reopened.getSessionData()
  assert.deepEqual(restored.tabs, snapshot.tabs)
  assert.deepEqual(restored.groups, snapshot.groups)
  assert.equal(restored.activeTabId, snapshot.activeTabId)
  assert.equal(reopened.sessionId, manager.sessionId)
})

for (const count of [1, 3]) {
  test(`closing all ${count} tabs retains the complete window snapshot`, async t => {
    const manager = createManager(t)
    await manager.restoreFromData(session(count), { restoreTabLoadState: true })
    const before = structuredClone(manager.getSessionDataForWindowClose())
    await manager.closeTabs([...manager.tabs.keys()])
    assert.equal(manager.tabs.size, 0)
    assert.deepEqual(manager.getSessionDataForWindowClose(), before)
  })
}

test('failed closed-window restoration cleans up without deleting its persisted session', async t => {
  const manager = createManager(t, 'closed-window-session')
  manager.createTab({ route: '/history' })
  tabSession.cleared = []
  await manager.clearSession({ preservePersistedSession: true })
  assert.deepEqual(tabSession.cleared, [])

  tabSession.saved = null
  await manager._saveSession()
  assert.equal(tabSession.saved, null)
})

test('foreground tabs become selected before their content mounts', async t => {
  const manager = createManager(t)
  const original = manager.createTab({ route: '/history' })
  presentActive(manager)

  const tab = await manager.createTabWithPreference({ route: '/subscriptions', makeActive: true })
  assert.equal(tab.loadState, 'mounting')
  assert.equal(manager.activeTabId, tab.id)
  assert.equal(manager.presentedTabId, original.id, 'keeps the previous content until the new content is ready')

  manager.markTabMounted(tab.id, tab.mountRevision)
  manager.markTabPresented(tab.id, manager.selectionRevision)
  assert.equal(manager.presentedTabId, tab.id)
})

test('slow foreground tab mounts cannot steal a newer selection', async t => {
  const manager = createManager(t)
  const original = manager.createTab({ route: '/history' })
  presentActive(manager)
  const first = await manager.createTabWithPreference({ route: '/subscriptions', makeActive: true })
  const second = await manager.createTabWithPreference({ route: '/about', makeActive: true })
  assert.equal(manager.activeTabId, second.id)

  manager.markTabMounted(second.id, second.mountRevision)
  manager.markTabMounted(first.id, first.mountRevision)
  assert.equal(manager.activeTabId, second.id)

  const third = await manager.createTabWithPreference({ route: '/playlists', makeActive: true })
  manager.activateTab(original.id)
  manager.markTabMounted(third.id, third.mountRevision)
  assert.equal(manager.activeTabId, original.id)
})

test('background tab creation and mounting preserve the selected tab', async t => {
  const manager = createManager(t)
  const original = manager.createTab({ route: '/history' })
  presentActive(manager)
  const tab = await manager.createTabWithPreference({ route: '/subscriptions', makeActive: false })
  assert.equal(manager.activeTabId, original.id)
  manager.markTabMounted(tab.id, tab.mountRevision)
  assert.equal(manager.activeTabId, original.id)
})

test('restoring many tabs serializes only one initial renderer snapshot', async t => {
  const manager = createManager(t)
  const getState = manager.getState.bind(manager)
  let serializedTabs = 0
  manager.getState = (...args) => {
    const state = getState(...args)
    serializedTabs += state.tabs.length
    return state
  }
  const started = performance.now()
  await manager.restoreFromData(session(100), { restoreTabLoadState: true })
  t.diagnostic(`100 tabs: ${(performance.now() - started).toFixed(1)} ms, ${serializedTabs} serialized tab records`)
  assert.equal(serializedTabs, 100)
})

test('restored background pages do not compete with the initial selected page mount', async t => {
  const manager = createManager(t)
  await manager.restoreFromData(session(10), { restoreTabLoadState: true })
  assert.deepEqual([...manager.tabs.values()].filter(tab => tab.loadState === 'mounting' && !tab.mountDeferred).map(tab => tab.id), ['tab-9'])
  assert.ok(manager.getSyncSession().tabs.every(tab => !tab.isUnloaded), 'queued tabs keep their saved loaded state')
})

for (const persistence of ['disk', 'sync']) {
  test(`restarting from ${persistence} while the selected video loads preserves background video load state`, async t => {
    const manager = createManager(t)
    const saved = session(4)
    saved.tabs[0].url = 'app://bundle/index.html#/watch/background'
    saved.tabs[2].url = 'app://bundle/index.html#/watch/unloaded'
    saved.tabs[2].isUnloaded = true
    saved.tabs[3].url = 'app://bundle/index.html#/watch/selected'
    await manager.restoreFromData(saved, { restoreTabLoadState: true })
    await manager._saveSession()
    const snapshot = persistence === 'disk' ? tabSession.saved : manager.getSyncSession()
    assert.deepEqual(snapshot.tabs.map(tab => tab.isUnloaded), [false, false, true, false])
    const restarted = createManager(t)
    await restarted.restoreFromData(snapshot, { restoreTabLoadState: true })
    restarted.setTabLoading('tab-3', true)
    restarted.setTabLoading('tab-3', false)
    restarted.setTabPlaybackState('tab-3', 'playing')
    await new Promise(setImmediate)
    assert.notEqual(restarted.tabs.get('tab-0').loadState, 'unloaded')
    assert.equal(restarted.tabs.get('tab-2').loadState, 'unloaded')
  })
}

for (const action of ['unload', 'load', 'reload']) {
  test(`${action} overrides a deferred startup video's saved load state`, async t => {
    const manager = createManager(t)
    const saved = session(2)
    for (const tab of saved.tabs) tab.url = `app://bundle/index.html#/watch/${tab.id}`
    await manager.restoreFromData(saved, { restoreTabLoadState: true })
    if (action === 'unload') {
      assert.equal(await manager.unloadTab('tab-0'), true)
    } else {
      if (action === 'load') manager.loadTab('tab-0')
      else manager.reloadTab('tab-0')
      const tab = manager.tabs.get('tab-0')
      manager.markTabMountFailed(tab.id, tab.mountRevision)
    }
    manager.setTabLoading('tab-1', true)
    manager.setTabLoading('tab-1', false)
    await new Promise(setImmediate)
    assert.equal(manager.tabs.get('tab-0').loadState, 'unloaded')
    await manager._saveSession()
    assert.equal(tabSession.saved.tabs[0].isUnloaded, true)
    assert.equal(manager.getSyncSession().tabs[0].isUnloaded, true)
  })
}

async function tick(t, milliseconds = 50) {
  t.mock.timers.tick(milliseconds)
  await new Promise(setImmediate)
}

function presentActive(manager) {
  const tab = manager.tabs.get(manager.activeTabId)
  manager.markTabMounted(tab.id, tab.mountRevision)
  manager.markTabPresented(tab.id, manager.selectionRevision)
}

test('loads background pages one at a time after presentation and mount acknowledgement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(4), { restoreTabLoadState: true })
  await tick(t, 1000)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, true)
  presentActive(manager)
  await tick(t)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, true)
  await tick(t, 1000)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, true, 'waits for slow mount')
  manager.markTabMounted('tab-0', 1)
  await tick(t, 0)
  await tick(t)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
  manager.markTabMountFailed('tab-1', 1)
  await tick(t, 0)
  await tick(t)
  assert.equal(manager.tabs.get('tab-2').mountDeferred, false, 'continues after failure')
  manager.markTabMounted('tab-2', 1)
  await tick(t, 0)
  assert.equal(manager._startupMountQueue.size, 0)
})

test('selecting or reloading a queued tab bypasses the startup queue', async t => {
  const manager = createManager(t)
  await manager.restoreFromData(session(4), { loadInactiveTabs: true })
  manager.activateTab('tab-2')
  assert.equal(manager.tabs.get('tab-2').mountDeferred, false)
  assert.equal(manager.activeTabId, 'tab-2')
  assert.equal(manager._startupMountQueue.has('tab-2'), false)
  manager.reloadTab('tab-1')
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
  assert.equal(manager._startupMountQueue.has('tab-1'), false)
})

test('skips tabs unloaded while queued and preserves originally unloaded tabs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  const saved = session(4)
  saved.tabs[1].isUnloaded = true
  await manager.restoreFromData(saved, { restoreTabLoadState: true })
  await manager.unloadTab('tab-0')
  presentActive(manager)
  await tick(t)
  assert.equal(manager.tabs.get('tab-0').loadState, 'unloaded')
  assert.equal(manager.tabs.get('tab-1').loadState, 'unloaded')
  assert.equal(manager.tabs.get('tab-2').mountDeferred, false)
  assert.deepEqual(manager.getSyncSession().tabs.map(tab => tab.isUnloaded), [true, true, false, false])
})

test('unloading a background tab during its mount releases the next queued tab', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(3), { restoreTabLoadState: true })
  presentActive(manager)
  await tick(t)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
  await manager.unloadTab('tab-0')
  await tick(t, 0)
  await tick(t)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
})

test('a missing selected tab falls back to a tab that can mount immediately', async t => {
  const manager = createManager(t)
  const saved = session(4)
  saved.activeTabId = 'missing'
  await manager.restoreFromData(saved, { restoreTabLoadState: true })
  assert.equal(manager.activeTabId, 'tab-0')
  assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
})

test('a stalled mount cannot block the rest of the session forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(3), { restoreTabLoadState: true })
  presentActive(manager)
  await tick(t)
  await tick(t, 8000)
  await tick(t)
  assert.equal(manager.tabs.get('tab-1').mountDeferred, false)
})

test('reads each shared avatar once and starts independent reads together', async t => {
  const manager = createManager(t)
  const saved = session(4)
  const avatar = createTabAvatarFileName(Buffer.from('avatar'))
  const missingAvatar = createTabAvatarFileName(Buffer.from('missing'))
  saved.tabs[0].avatarFileName = avatar
  saved.tabs[1].avatarFileName = avatar
  saved.tabs[2].avatarFileName = missingAvatar
  const reads = new Map()
  t.mock.method(tabPreviewStorage, 'read', fileName => {
    assert.ok(!reads.has(fileName), 'shared file is read only once')
    return new Promise(resolve => reads.set(fileName, resolve))
  })
  const restored = manager.restoreFromData(saved)
  await new Promise(setImmediate)
  assert.deepEqual([...reads.keys()], [avatar, missingAvatar])
  const dataUrl = 'data:image/jpeg;base64,YXZhdGFy'
  reads.get(avatar)(dataUrl)
  reads.get(missingAvatar)(null)
  await restored
  assert.equal(manager.tabs.get('tab-0').avatarDataUrl, dataUrl)
  assert.equal(manager.tabs.get('tab-1').avatarDataUrl, dataUrl)
  assert.equal(manager.tabs.get('tab-2').avatarFileName, null)
})

test('closing the window cancels pending background mounts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  await manager.restoreFromData(session(3), { loadInactiveTabs: true })
  presentActive(manager)
  manager.browserWindow.isDestroyed = () => true
  manager.browserWindow.emit('closed')
  await tick(t, 10_000)
  assert.equal(manager.tabs.get('tab-0').mountDeferred, true)
  assert.equal(manager._pendingTabMountWaiters.size, 0)
})

for (const existingLanding of [false, true]) {
  test(`landing-page startup ${existingLanding ? 'reuses an existing tab' : 'adds a tab'} and unloads every other tab`, async t => {
    const manager = createManager(t)
    t.mock.method(TabManager, 'getStoredLandingRoute', async () => '/subscriptions')
    const saved = session(3)
    saved.tabs[0].title = ''
    if (existingLanding) {
      saved.tabs[1].url = 'app://bundle/index.html#/subscriptions'
      saved.tabs[1].isUnloaded = true
      saved.tabs[1].isPinned = true
    }
    await manager.restoreFromData(saved, { loadLandingPage: true })
    const tabs = [...manager.tabs.values()]
    assert.equal(tabs.length, existingLanding ? 3 : 4)
    const active = manager.tabs.get(manager.activeTabId)
    assert.equal(TabManager.getRouteFromUrl(active.url).path, '/subscriptions')
    assert.equal(active.loadState, 'mounting')
    if (existingLanding) {
      assert.equal(active.id, 'tab-1')
      assert.equal(active.isPinned, true)
    }
    assert.ok(tabs.filter(tab => tab !== active).every(tab => tab.loadState === 'unloaded'))
    presentActive(manager)
    assert.equal(manager._startupMountQueue.size, 0)
    assert.deepEqual(saved.tabs.map(tab => tab.id), ['tab-0', 'tab-1', 'tab-2'])
  })
}

test('landing-page startup selects only the first matching tab', async t => {
  const manager = createManager(t)
  t.mock.method(TabManager, 'getStoredLandingRoute', async () => '/history')
  await manager.restoreFromData(session(3), { loadLandingPage: true })
  assert.equal(manager.activeTabId, 'tab-0')
  assert.equal(manager.tabs.size, 3)
  assert.deepEqual([...manager.tabs.values()].map(tab => tab.loadState), ['mounting', 'unloaded', 'unloaded'])
})

test('group icons are validated, updated and restored from session metadata', t => {
  const manager = createManager(t)
  const group = manager.createTabGroup({ name: 'Research', icon: 'bookmark' })
  assert.equal(group.icon, 'bookmark')
  assert.equal(manager.updateTabGroup(group.id, { icon: 'flask' }), true)
  assert.equal(manager.tabGroups.get(group.id).icon, 'flask')
  manager._restoreTabGroups([...manager.tabGroups.values()])
  assert.equal(manager.tabGroups.get(group.id).icon, 'flask')
  manager.updateTabGroup(group.id, { icon: '../invalid.svg' })
  assert.equal(manager.tabGroups.get(group.id).icon, 'layer-group')
})

test('closing tabs returns through activation history instead of tab order', async t => {
  TabManager.setTabCloseFocus('lastActiveTab')
  const manager = createManager(t)
  await manager.restoreFromData(session(5), { restoreTabLoadState: true })
  manager.activateTab('tab-0')
  manager.activateTab('tab-2')
  manager.closeTab('tab-2')
  assert.equal(manager.activeTabId, 'tab-0')
  manager.closeTab('tab-0')
  assert.equal(manager.activeTabId, 'tab-4')
})

test('last active focus skips unavailable tabs and falls back right then left', async t => {
  TabManager.setTabCloseFocus('lastActiveTab')
  const manager = createManager(t)
  await manager.restoreFromData(session(5), { restoreTabLoadState: true })
  manager.activateTab('tab-0')
  manager.activateTab('tab-2')
  manager._deferredCloseTabIds.add('tab-0')
  assert.equal(manager._getNeighborTabId('tab-2'), 'tab-4')
  assert.equal(manager._getNeighborTabId('tab-2', false, new Set(['tab-4'])), 'tab-3')
  manager.tabs.get('tab-3').isTransferStaged = true
  assert.equal(manager._getNeighborTabId('tab-2', false, new Set(['tab-4'])), 'tab-1')
})

test('desktop background closes preserve focus and closed history entries are skipped', async t => {
  TabManager.setTabCloseFocus('lastActiveTab')
  const manager = createManager(t)
  await manager.restoreFromData(session(5), { restoreTabLoadState: true })
  manager.activateTab('tab-0')
  manager.activateTab('tab-2')
  manager.closeTab('tab-0')
  assert.equal(manager.activeTabId, 'tab-2')
  manager.closeTab('tab-2')
  assert.equal(manager.activeTabId, 'tab-4')
})

test('desktop defaults to last active focus while preserving directional preferences', () => {
  assert.equal(TabManager.normalizeTabCloseFocus(undefined), 'lastActiveTab')
  assert.equal(TabManager.normalizeTabCloseFocus('invalid'), 'lastActiveTab')
  assert.equal(TabManager.normalizeTabCloseFocus('previousTab'), 'previousTab')
  assert.equal(TabManager.normalizeTabCloseFocus('nextTab'), 'nextTab')
})

test('navigation metadata shares one bounded session write and explicit saves flush it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  const saves = t.mock.method(tabSession, 'save', async () => {})
  const tab = manager.createTab({ route: '/history' })
  manager.updateTabRoute(tab.id, { path: '/home' })
  manager.updateTabNavigationHistory(tab.id, [{ route: { path: '/home' }, title: 'Home' }], 0, true)
  manager.applyTabTitle(tab, 'Home title')
  assert.equal(saves.mock.callCount(), 0, 'metadata must wait for the coalescing window')
  t.mock.timers.tick(250)
  await Promise.resolve()
  assert.equal(saves.mock.callCount(), 1)
  assert.equal(saves.mock.calls[0].arguments[1].tabs[0].title, 'Home title')
  manager.applyTabTitle(tab, 'Latest title')
  await manager._saveSession()
  assert.equal(saves.mock.callCount(), 2)
  t.mock.timers.tick(250)
  assert.equal(saves.mock.callCount(), 2, 'flush cancels the pending timer')
})

test('clearing a session cancels pending writes instead of resurrecting it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  const saves = t.mock.method(tabSession, 'save', async () => {})
  manager.createTab({ route: '/history' })
  await manager.clearSession()
  t.mock.timers.tick(250)
  await Promise.resolve()
  assert.equal(saves.mock.callCount(), 0)
})

test('unpersisted history and unchanged session snapshots do not write again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const manager = createManager(t)
  const saves = t.mock.method(tabSession, 'save', async () => {})
  const tab = manager.createTab({ route: '/history' })
  await manager._saveSession()
  manager.updateTabNavigationHistory(tab.id, [{ route: { path: '/history' }, title: 'History' }], 0, false)
  await manager._saveSession()
  assert.equal(saves.mock.callCount(), 1)
  manager.updateTabNavigationHistory(tab.id, [{ route: { path: '/history' }, title: 'History' }], 0, true)
  await manager._saveSession()
  assert.equal(saves.mock.callCount(), 2)
})

test('extracted IPC handlers keep tab commands scoped to the sender window', async t => {
  const first = createManager(t, 'first', 1)
  const second = createManager(t, 'second', 2)
  const firstTab = first.createTab({ route: '/history' })
  const secondTab = second.createTab({ route: '/home' })
  const handlers = await setupIpc(t, [first, second])
  const sender = { sender: first.browserWindow.webContents }
  handlers.get(IpcChannels.TABS_UPDATE_TITLE)(sender, 'First title', firstTab.id)
  assert.equal(firstTab.title, 'First title')
  const originalTitle = secondTab.title
  handlers.get(IpcChannels.TABS_UPDATE_TITLE)(sender, 'Foreign title', secondTab.id)
  assert.equal(secondTab.title, originalTitle)
  assert.equal(handlers.get(IpcChannels.TABS_GET_STATE)({ sender: {} }), null)
  const created = await handlers.get(IpcChannels.TABS_CREATE)(sender, { route: '/about', id: secondTab.id })
  assert.notEqual(created.id, secondTab.id)
  assert.equal(created.route.path, '/about')
  assert.equal(first.tabs.has(created.id), true)
  assert.equal(second.tabs.has(created.id), false)
  assert.equal(handlers.get(IpcChannels.TABS_GET_SYNC_SESSIONS)().length, 2)
})

test('a change reverted during an in-flight write still persists the latest state', async t => {
  const manager = createManager(t)
  const tab = manager.createTab({ route: '/history', title: 'Original' })
  await manager._saveSession()
  let finishWrite
  const saves = t.mock.method(tabSession, 'save', () => new Promise(resolve => { finishWrite = resolve }))
  manager.applyTabTitle(tab, 'Temporary')
  const first = manager._saveSession()
  const finishFirst = finishWrite
  manager.applyTabTitle(tab, 'Original')
  const second = manager._saveSession()
  const calls = saves.mock.callCount()
  finishFirst()
  finishWrite()
  await Promise.all([first, second])
  assert.equal(calls, 2, 'the pending temporary snapshot must be followed by the reversion')
  assert.equal(saves.mock.calls[1].arguments[1].tabs[0].title, 'Original')
})

test('failed session writes can retry the same snapshot', async t => {
  const manager = createManager(t)
  manager.createTab({ route: '/history' })
  let attempts = 0
  t.mock.method(console, 'error', () => {})
  t.mock.method(tabSession, 'save', async () => {
    if (++attempts === 1) throw new Error('disk write failed')
  })
  await manager._saveSession()
  await manager._saveSession()
  await manager._saveSession()
  assert.equal(attempts, 2)
})

for (const count of [1, 2]) {
  test(`duplicate tab IDs cannot bypass close confirmation for ${count} tabs`, async t => {
    const manager = createManager(t)
    const tabs = Array.from({ length: count }, () => manager.createTab({ route: '/history' }))
    let confirmations = 0
    let windowCloses = 0
    let allowClose = false
    manager.browserWindow.close = () => { windowCloses++ }
    const handlers = await setupIpc(t, [manager], {
      confirmCloseWindow: () => { confirmations++; return allowClose }
    })
    const close = handlers.get(IpcChannels.TABS_CLOSE_MULTIPLE)
    const event = { sender: manager.browserWindow.webContents }
    const ids = [...tabs.flatMap(tab => [tab.id, tab.id]), 'missing', null, 123]
    const cancelled = await close(event, ids)
    assert.equal(confirmations, 1)
    assert.equal(cancelled.hasRemainingTabs, true)
    assert.equal(manager.tabs.size, count)
    assert.equal(windowCloses, 0)
    allowClose = true
    const approved = await close(event, ids)
    assert.equal(confirmations, 2)
    assert.equal(approved.hasRemainingTabs, false)
    assert.equal(manager.tabs.size, 0)
    assert.equal(manager.closedTabs.length, count)
    assert.equal(windowCloses, 1)
  })
}

test('route IPC rejects malformed URL values and permits omitted URLs', async t => {
  const manager = createManager(t)
  const tab = manager.createTab({ route: '/history' })
  const handlers = await setupIpc(t, [manager])
  const update = handlers.get(IpcChannels.TABS_UPDATE_ROUTE)
  const event = { sender: manager.browserWindow.webContents }
  const originalUrl = tab.url
  for (const url of [{ path: '/home' }, [], true, 42]) {
    update(event, { tabId: tab.id, route: { path: '/home' }, url })
    assert.equal(tab.url, originalUrl)
    assert.equal(tab.route.path, '/history')
  }
  for (const url of [undefined, null, 'app://bundle/index.html#/home']) {
    update(event, { tabId: tab.id, route: { path: '/home' }, url })
    assert.equal(tab.url, 'app://bundle/index.html#/home')
    assert.equal(tab.route.path, '/home')
  }
  await manager._saveSession()
  assert.equal(tabSession.saved.tabs[0].url, 'app://bundle/index.html#/home')
})

for (const outcome of ['playing', 'paused', 'failed']) {
  test(`startup waits for active playback before releasing all background tabs: ${outcome}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const manager = createManager(t)
    const saved = session(4)
    saved.tabs[0].url = 'app://bundle/index.html#/watch/background'
    saved.tabs[2].isUnloaded = true
    saved.tabs[3].url = 'app://bundle/index.html#/watch/active'
    await manager.restoreFromData(saved, { restoreTabLoadState: true })
    const handlers = await setupIpc(t, [manager])
    const playback = state => handlers.get(IpcChannels.TABS_SET_PLAYBACK_STATE)(
      { sender: manager.browserWindow.webContents }, state, 'tab-3')
    presentActive(manager)
    manager.setTabLoading('tab-3', true)
    manager.setTabLoading('tab-3', false)
    playback('waiting')
    playback('none')
    manager.setTabPlaybackState('tab-0', 'playing')
    await tick(t, 1000)
    for (const id of ['tab-0', 'tab-1']) {
      const tab = manager.getState().tabs.find(tab => tab.id === id)
      assert.equal(tab.isLoading, true, 'queued tabs show a spinner')
      assert.equal(tab.isUnloaded, false, 'queued tabs do not look unloaded')
      assert.ok(tab.loadState === 'unloaded' || tab.mountDeferred, 'metadata and buffering do not release background work')
    }
    playback(outcome)
    await tick(t)
    assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
    assert.equal(manager.tabs.get('tab-0').loadState, 'mounting')
    assert.equal(manager.tabs.get('tab-2').loadState, 'unloaded')
  })
}

for (const action of ['closeTab', 'detachTabForTransfer']) {
  test(`startup queue drops tabs removed by ${action}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const manager = createManager(t)
    const saved = session(3)
    saved.tabs[2].url = 'app://bundle/index.html#/watch/active'
    await manager.restoreFromData(saved, { restoreTabLoadState: true })
    presentActive(manager)

    manager[action]('tab-0')
    assert.deepEqual([...manager._deferredStartupTabIds], ['tab-1'])
    manager[action]('tab-1')
    assert.equal(manager._deferredStartupTabIds.size, 0)

    const tab = manager.createTab({ route: '/watch/new', makeActive: false })
    manager.activateTab(tab.id)
    assert.equal(manager._startupPriorityTabId, 'tab-2', 'removed tabs cannot redirect startup priority')
  })
}

for (const action of ['select', 'close', 'navigate', 'unload queued']) {
  test(`startup playback wait handles ${action}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const manager = createManager(t)
    const saved = session(3)
    saved.tabs[2].url = 'app://bundle/index.html#/watch/active'
    await manager.restoreFromData(saved, { restoreTabLoadState: true })
    presentActive(manager)
    if (action === 'select') {
      manager.activateTab('tab-1')
      presentActive(manager)
    } else if (action === 'close') {
      manager.closeTab('tab-2')
      presentActive(manager)
    } else if (action === 'navigate') {
      manager.updateTabRoute('tab-2', { path: '/history' })
    } else {
      await manager.unloadTab('tab-0')
      const tab = manager.getState().tabs.find(tab => tab.id === 'tab-0')
      assert.equal(tab.isLoading, false)
      assert.equal(tab.isUnloaded, true)
      manager.setTabPlaybackState('tab-2', 'playing')
      await tick(t)
      assert.equal(manager.tabs.get('tab-0').loadState, 'unloaded')
      return
    }
    await tick(t)
    assert.equal(manager.tabs.get('tab-0').loadState, 'mounting')
    assert.equal(manager.tabs.get('tab-0').mountDeferred, false)
  })
}
