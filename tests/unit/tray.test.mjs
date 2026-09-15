import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')

function fixture(platform = 'linux') {
  const windows = []
  const trays = []
  const timers = new Map()
  let timerId = 0
  const mediaActions = []
  const minimizedStates = []
  let mediaSession = null
  class Window extends EventEmitter {
    id = windows.length + 1
    visible = true
    minimized = false
    maximized = false
    destroyed = false
    webContents = { isDestroyed: () => false, send(channel, state) { if (channel === 'minimized') minimizedStates.push(state) } }
    constructor() { super(); windows.push(this) }
    isVisible() { return this.visible }
    isMinimized() { return this.minimized }
    isMaximized() { return this.maximized }
    isDestroyed() { return this.destroyed }
    getTitle() { return `Window ${this.id}` }
    show() { this.visible = true; this.emit('show') }
    hide() { this.visible = false; this.emit('hide') }
    restore() { this.minimized = false; this.emit('restore') }
    maximize() { this.maximized = true; this.emit('maximize') }
    focus() { this.emit('focus') }
  }
  class Tray extends EventEmitter {
    destroyed = false
    constructor() { super(); trays.push(this) }
    setToolTip() {}
    setIgnoreDoubleClickEvents() {}
    setContextMenu(menu) { this.menu = menu }
    popUpContextMenu(menu) { this.menu = menu }
    destroy() { this.destroyed = true }
    isDestroyed() { return this.destroyed }
  }
  const context = vm.createContext({
    process: { platform, env: {} }, path: { join: () => '/icon.png' }, __dirname: '/',
    Tray, BrowserWindow: { getAllWindows: () => windows, getFocusedWindow: () => windows[0] },
    Menu: { buildFromTemplate: items => items },
    createWindow: () => new Window(), requestQuit: () => {},
    getDockMediaSession: () => mediaSession,
    requestDockMediaAction: action => mediaActions.push(action),
    IpcChannels: { WINDOW_MINIMIZED_STATE: 'minimized' }, monitorsKdeWaylandWindowState: true, kdeWaylandWindowStateBackend: null,
    applyKdeWindowIdentity() {}, releaseKdeWindowIdentity() {},
    monitorKdeWaylandWindowState: options => { context.kdeCallback = options.onMinimizedState },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId },
    clearTimeout: id => timers.delete(id),
  })
  vm.runInContext(`
    let tray = null, mainWindow, useTrayIcon = true, keepRefreshingInBackground = false;
    let trayOnClose = false, trayOnMinimize = false, isQuitting = false;
    let trayWindows = [];
    const trayMaximizedWindows = {};
    const trayClosingWindowIds = new Set();
    const trayTranslate = key => key;
    const dockMediaLabels = { previous: 'Previous', play: 'Play', pause: 'Pause', next: 'Next', newWindow: 'New Window' };
    let isTrayOnMinimizeSupported = true;
    ${source.slice(source.indexOf('  function ensureBackgroundTray()'), source.indexOf('\n  asyncFs.rm(', source.indexOf('  function ensureBackgroundTray()')))}
    ${source.slice(source.indexOf('  function isTrayEnabled()'), source.indexOf('  /**\n   * @param {string} extension'))}
    function configure(values) {
      if ('enabled' in values) useTrayIcon = values.enabled;
      if ('background' in values) keepRefreshingInBackground = values.background;
      if ('minimize' in values) trayOnMinimize = values.minimize;
      if ('quitting' in values) isQuitting = values.quitting;
      updateTrayEnabled();
    }
    function attach(newWindow) {
      ${source.slice(source.indexOf('    // Forward the native window minimized state'), source.indexOf('\n    if (replaceMainWindow)', source.indexOf('    // Forward the native window minimized state')))}
    }
    function hiddenCount() { return trayWindows.length; }
  `, context)
  return { context, windows, trays, Window, mediaActions, minimizedStates,
    setMedia: session => { mediaSession = session },
    flushTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } },
  }
}

test('tray defaults on, toggles a window, and restores it before disabling', () => {
  const { context, Window, trays } = fixture()
  const window = new Window()
  context.configure({})
  assert.equal(trays.length, 1)
  trays[0].emit('click')
  assert.equal(window.visible, false)
  assert.equal(context.hiddenCount(), 1)
  trays[0].emit('click')
  assert.equal(window.visible, true)
  assert.equal(context.hiddenCount(), 0)
  trays[0].emit('click')
  context.configure({ enabled: false })
  assert.equal(window.visible, true)
  assert.equal(trays[0].destroyed, true)
})

test('background refresh forces the tray without overwriting the preference', () => {
  const { context, Window, trays } = fixture()
  const window = new Window()
  context.configure({ enabled: false, background: true })
  trays[0].emit('click')
  context.configure({ enabled: false })
  assert.equal(trays[0].destroyed, false)
  context.configure({ background: false })
  assert.equal(window.visible, true)
  assert.equal(trays[0].destroyed, true)
})

test('restoring an untracked window leaves other hidden windows tracked', () => {
  const { context, Window } = fixture()
  const hidden = new Window()
  const visible = new Window()
  context.hideWindowToTray(hidden)
  context.trayClick(visible)
  assert.equal(context.hiddenCount(), 1)
  context.showHiddenWindows()
  assert.equal(hidden.visible, true)
})

test('tray restores minimized and maximized windows and opens a window when none remain', () => {
  const { context, windows, trays } = fixture()
  context.configure({})
  trays[0].emit('click')
  assert.equal(windows.length, 1)
  windows[0].maximized = true
  context.hideWindowToTray(windows[0])
  windows[0].minimized = true
  windows[0].maximized = false
  trays[0].emit('click')
  assert.equal(windows[0].minimized, false)
  assert.equal(windows[0].maximized, true)
})

for (const trigger of ['native', 'kde']) {
  test(`${trigger} minimize uses the Linux restore-before-hide workaround`, () => {
    const { context, Window, flushTimers } = fixture()
    const window = new Window()
    context.attach(window)
    context.configure({ minimize: true })
    window.minimized = true
    if (trigger === 'kde') context.kdeCallback(true)
    else window.emit('minimize')
    flushTimers()
    assert.equal(window.minimized, false)
    assert.equal(window.visible, false)
    assert.equal(context.hiddenCount(), 1)
    context.trayClick(window)
    assert.equal(window.visible, true)
    assert.equal(context.hiddenCount(), 0)
  })
}

for (const interruption of ['restore', 'show', 'focus', 'disable', 'quit', 'closed']) {
  test(`pending minimize-to-tray is cancelled by ${interruption}`, () => {
    const { context, Window, flushTimers } = fixture()
    const window = new Window()
    context.attach(window)
    context.configure({ minimize: true })
    window.emit('minimize')
    if (interruption === 'disable') context.configure({ enabled: false })
    else if (interruption === 'quit') context.configure({ quitting: true })
    else window.emit(interruption)
    flushTimers()
    assert.equal(window.visible, true)
  })
}

test('tray media controls reflect supported actions and playback state', () => {
  const { context, setMedia, mediaActions } = fixture()
  const controls = () => context.defaultTrayMenu().filter(item => ['Previous', 'Play', 'Pause', 'Next'].includes(item.label))
  assert.ok(controls().every(item => !item.enabled))
  setMedia({ playbackState: 'playing', actions: new Set(['pause', 'nexttrack']) })
  assert.deepEqual(Array.from(controls(), item => [item.label, item.enabled]), [['Previous', false], ['Pause', true], ['Next', true]])
  controls()[1].click()
  controls()[2].click()
  assert.deepEqual(mediaActions, ['pause', 'nexttrack'])
  setMedia({ playbackState: 'paused', actions: new Set(['play']) })
  assert.equal(controls()[1].label, 'Play')
})

test('macOS reserves left click for toggling and right click for the menu', () => {
  const { context, Window, trays } = fixture('darwin')
  const window = new Window()
  context.configure({})
  assert.equal(trays[0].menu, undefined)
  trays[0].emit('click')
  assert.equal(window.visible, false)
  trays[0].emit('right-click')
  assert.ok(trays[0].menu.some(item => item.label === 'Quit'))
})


test('KWin restore polling does not clear minimized state while hidden in the tray', () => {
  const { context, Window, flushTimers, minimizedStates } = fixture()
  const window = new Window()
  context.attach(window)
  context.configure({ minimize: true })
  context.kdeCallback(true)
  flushTimers()
  assert.equal(window.visible, false)
  context.kdeCallback(false)
  assert.equal(minimizedStates.at(-1), true)
  context.trayClick(window)
  assert.equal(minimizedStates.at(-1), false)
})
