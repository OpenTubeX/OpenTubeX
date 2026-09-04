import assert from 'node:assert/strict'
import dbus from 'dbus-native'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createKdeWaylandWindowStateBackend,
  extractKwinWindowHandles,
  findNewlyMinimizedWindow,
  isKdePlasmaDesktop,
  isWaylandPlatform,
  monitorKdeWaylandWindowState,
  normalizeKwinWindowInfo,
  shouldMonitorKdeWaylandWindowState,
} from '../../src/main/kdeWaylandWindowState.js'

test('recognizes common KDE Plasma desktop environment values', () => {
  assert.equal(isKdePlasmaDesktop({ XDG_CURRENT_DESKTOP: 'KDE' }), true)
  assert.equal(isKdePlasmaDesktop({ XDG_CURRENT_DESKTOP: 'KDE:GNOME' }), true)
  assert.equal(isKdePlasmaDesktop({ XDG_SESSION_DESKTOP: 'plasmawayland' }), true)
  assert.equal(isKdePlasmaDesktop({ DESKTOP_SESSION: '/usr/share/wayland-sessions/plasma' }), true)
  assert.equal(isKdePlasmaDesktop({ KDE_FULL_SESSION: 'true' }), true)
})

test('does not treat other desktops as KDE Plasma', () => {
  assert.equal(isKdePlasmaDesktop({ XDG_CURRENT_DESKTOP: 'GNOME' }), false)
  assert.equal(isKdePlasmaDesktop({ XDG_CURRENT_DESKTOP: 'sway' }), false)
  assert.equal(isKdePlasmaDesktop({}), false)
})

test('reports native Wayland only for an explicit Electron runtime choice', () => {
  assert.equal(isWaylandPlatform({
    platform: 'linux',
    ozonePlatform: 'wayland',
    environment: {},
  }), true)
  assert.equal(isWaylandPlatform({
    platform: 'linux',
    ozonePlatform: '',
    environment: { XDG_SESSION_TYPE: 'wayland' },
  }), false)
  assert.equal(isWaylandPlatform({
    platform: 'linux',
    ozonePlatform: 'x11',
    environment: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' },
  }), false)
})

test('monitors window state only for KDE Plasma in a Wayland session', () => {
  const kde = { XDG_CURRENT_DESKTOP: 'KDE' }

  assert.equal(shouldMonitorKdeWaylandWindowState({
    platform: 'linux',
    ozonePlatform: 'wayland',
    environment: kde,
  }), true)
  assert.equal(shouldMonitorKdeWaylandWindowState({
    platform: 'linux',
    ozonePlatform: 'x11',
    environment: { ...kde, XDG_SESSION_TYPE: 'wayland' },
  }), false)
  assert.equal(shouldMonitorKdeWaylandWindowState({
    platform: 'linux',
    ozonePlatform: 'wayland',
    environment: { XDG_CURRENT_DESKTOP: 'GNOME' },
  }), false)
  assert.equal(shouldMonitorKdeWaylandWindowState({
    platform: 'win32',
    ozonePlatform: 'wayland',
    environment: kde,
  }), false)
})

test('extracts KWin runner handles and validates D-Bus window state', () => {
  const matches = [
    [
      '0_{01234567-89ab-cdef-0123-456789abcdef}',
      'Subscriptions - OpenTubeX',
      'electron',
      100,
      1,
      {},
    ],
  ]
  const windowInfo = {
    caption: 'Subscriptions - OpenTubeX',
    height: 832,
    minimized: true,
    pid: 1234,
    uuid: '{01234567-89ab-cdef-0123-456789abcdef}',
    width: 1200,
  }

  assert.deepEqual(extractKwinWindowHandles(matches), [
    '{01234567-89ab-cdef-0123-456789abcdef}',
  ])
  assert.deepEqual(normalizeKwinWindowInfo(windowInfo), {
    uuid: '{01234567-89ab-cdef-0123-456789abcdef}',
    caption: 'Subscriptions - OpenTubeX',
    height: 832,
    minimized: true,
    pid: 1234,
    width: 1200,
  })
})

test('rejects malformed D-Bus window state and runner matches', () => {
  assert.equal(normalizeKwinWindowInfo({ minimized: true }), null)
  assert.deepEqual(extractKwinWindowHandles([['invalid-id'], null]), [])
})

test('reloads the KWin reporter with the new D-Bus name after reconnect', async t => {
  const originalSessionBus = dbus.sessionBus
  const bus = new EventEmitter()
  bus.name = ':1.10'
  bus.connection = new EventEmitter()
  const scripts = []
  let reportInterface
  let scriptRuns = 0
  let resolveSecondRun
  const secondRun = new Promise(resolve => {
    resolveSecondRun = resolve
  })
  const scripting = {
    unloadScript: async () => true,
  }
  const service = {
    getInterface: async path => {
      if (path === '/KWin') return { getWindowInfo: async () => null }
      if (path === '/WindowsRunner') return { Match: async () => [] }
      if (path === '/Scripting') return scripting
      return {
        run: async () => {
          scriptRuns++
          reportInterface.ReportActiveWindow('window', false, 'electron')
          if (scriptRuns === 2) resolveSecondRun()
        },
      }
    },
  }
  bus.getService = () => service
  bus.invoke = async ({ body: [scriptPath] }) => {
    scripts.push(await readFile(scriptPath, 'utf8'))
    return scripts.length
  }
  bus.exportInterface = implementation => {
    reportInterface = implementation
  }
  bus.unexportInterface = () => {}
  bus.close = async () => {}
  dbus.sessionBus = () => bus
  t.after(() => {
    dbus.sessionBus = originalSessionBus
  })

  const backend = await createKdeWaylandWindowStateBackend()
  assert.notEqual(backend, null)
  assert.match(scripts[0], /":1\.10"/)
  const activeWindows = []
  const watch = backend.watchActiveWindow(activeWindow => activeWindows.push(activeWindow))

  bus.name = ':1.11'
  bus.emit('reconnected', { name: bus.name })
  await secondRun

  assert.equal(scripts.length, 2)
  assert.match(scripts[1], /":1\.11"/)
  assert.doesNotMatch(scripts[1], /":1\.10"/)
  assert.deepEqual(activeWindows, [{ uuid: 'window', skipTaskbar: false, resourceClass: 'electron' }])
  watch.stop()
  await backend.close()
  assert.equal(bus.listenerCount('reconnected'), 0)
})

test('detects the KWin window newly minimized by a shortcut', () => {
  const previous = [
    windowInfo({ uuid: 'one', minimized: false }),
    windowInfo({ uuid: 'two', caption: 'Watch - OpenTubeX', minimized: true }),
  ]
  const current = [
    windowInfo({ uuid: 'one', minimized: true }),
    windowInfo({ uuid: 'two', caption: 'Watch - OpenTubeX', minimized: true }),
  ]

  assert.deepEqual(
    findNewlyMinimizedWindow(previous, current, targetWindow()),
    current[0]
  )
})

test('does not mistake an ordinary focus change for minimize', () => {
  const state = [
    windowInfo({ uuid: 'one', minimized: false }),
  ]

  assert.equal(findNewlyMinimizedWindow(state, state, targetWindow()), null)
})

test('waits for the KWin transition before reporting a minimized window', async () => {
  const browserWindow = new EventEmitter()
  browserWindow.getBounds = () => targetWindow().bounds
  browserWindow.getTitle = () => targetWindow().caption
  browserWindow.isFocused = () => false
  const minimizedStates = []
  let watcherStopped = false
  let stop
  const reported = new Promise(resolve => {
    stop = monitorKdeWaylandWindowState({
      browserWindow,
      backend: Promise.resolve({
        queryWindow: async () => windowInfo({ minimized: true }),
        queryWindows: async () => [windowInfo({ minimized: true })],
        watchActiveWindow: () => ({
          activeWindow: null,
          stop: () => { watcherStopped = true },
        }),
      }),
      onMinimizedState: minimized => {
        minimizedStates.push(minimized)
        resolve()
      },
      pollInterval: 60000,
    })
  })

  browserWindow.emit('blur')
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepEqual(minimizedStates, [])

  await reported
  stop()
  assert.equal(watcherStopped, true)
  assert.deepEqual(minimizedStates, [true])
})

test('keeps focus when a KDE desktop popup leaves the window active', async () => {
  const focusedStates = await focusedStatesAfterBlur({
    resourceClass: 'electron',
    skipTaskbar: false,
    uuid: 'window',
  })

  assert.deepEqual(focusedStates, [true])
})

test('keeps focus when a KDE shell popup becomes active', async () => {
  const focusedStates = await focusedStatesAfterBlur({
    resourceClass: 'org.kde.krunner',
    skipTaskbar: true,
    uuid: 'krunner',
  })

  assert.deepEqual(focusedStates, [true])
})

test('reports focus loss when another application window becomes active', async () => {
  const focusedStates = await focusedStatesAfterBlur({
    resourceClass: 'org.kde.konsole',
    skipTaskbar: false,
    uuid: 'konsole',
  })

  assert.deepEqual(focusedStates, [false])
})

test('does not mistake another app utility window for a KDE shell popup', async () => {
  const focusedStates = await focusedStatesAfterBlur({
    resourceClass: 'electron',
    skipTaskbar: true,
    uuid: 'picture-in-picture',
  })

  assert.deepEqual(focusedStates, [false])
})

test('reports an app switch made through a KDE shell popup', async () => {
  const focusedStates = await focusedStatesAfterBlur(
    {
      resourceClass: 'plasmashell',
      skipTaskbar: true,
      uuid: 'launcher',
    },
    {
      activeWindowChanges: [
        {
          resourceClass: 'electron',
          skipTaskbar: false,
          uuid: 'window',
        },
        {
          resourceClass: 'electron',
          skipTaskbar: false,
          uuid: 'window',
        },
        {
          resourceClass: 'org.kde.konsole',
          skipTaskbar: false,
          uuid: 'konsole',
        },
        {
          resourceClass: 'plasmashell',
          skipTaskbar: true,
          uuid: 'launcher',
        },
      ],
    }
  )

  assert.deepEqual(focusedStates, [true, true, true, false])
})

test('does not report transient focus loss while KWin hands off to another app', async () => {
  // Forwarding the empty report would produce false, true, false and make
  // automatic PiP open, close, then reopen during the same app switch.
  const focusedStates = await focusedStatesAfterBlur(
    {
      resourceClass: '',
      skipTaskbar: false,
      uuid: '',
    },
    {
      activeWindowChanges: [
        {
          resourceClass: 'electron',
          skipTaskbar: false,
          uuid: 'window',
        },
        {
          resourceClass: 'org.kde.konsole',
          skipTaskbar: false,
          uuid: 'konsole',
        },
      ],
      focusHandoffDelay: 30,
      settleDelay: 60,
    }
  )

  assert.deepEqual(focusedStates, [true, false])
})

test('reports focus loss when KWin keeps the active window empty', async () => {
  const focusedStates = await focusedStatesAfterBlur(
    {
      resourceClass: '',
      skipTaskbar: false,
      uuid: '',
    },
    { focusHandoffDelay: 0 }
  )

  assert.deepEqual(focusedStates, [false])
})

test('detects a single minimized window when no earlier KWin snapshot is available', () => {
  const current = [
    windowInfo({ uuid: 'one', minimized: true }),
  ]

  assert.deepEqual(
    findNewlyMinimizedWindow([], current, targetWindow()),
    current[0]
  )
})

test('identifies the only minimized window among duplicate captions', () => {
  const current = [
    windowInfo({ uuid: 'one', minimized: false }),
    windowInfo({ uuid: 'two', minimized: true }),
  ]

  assert.deepEqual(findNewlyMinimizedWindow([], current, targetWindow()), current[1])
})

test('uses size to identify a window when matching captions are already minimized', () => {
  const current = [
    windowInfo({ uuid: 'one', minimized: true, width: 900 }),
    windowInfo({ uuid: 'two', minimized: true }),
  ]

  assert.deepEqual(findNewlyMinimizedWindow([], current, targetWindow()), current[1])
})

test('uses the invisible startup identity for equal-sized minimized windows', () => {
  const target = targetWindow()
  target.caption += '\u2063\u200b'
  const current = [
    windowInfo({ uuid: 'one', minimized: true, caption: `${targetWindow().caption}\u2063\u200c` }),
    windowInfo({ uuid: 'two', minimized: true, caption: target.caption }),
  ]

  assert.deepEqual(findNewlyMinimizedWindow([], current, target), current[1])
})

test('preserves the window identity across title updates during detection', async () => {
  const browserWindow = new EventEmitter()
  browserWindow.getBounds = () => targetWindow().bounds
  let title = targetWindow().caption
  browserWindow.getTitle = () => title
  browserWindow.isFocused = () => false

  let resolveBackend
  const backend = new Promise(resolve => {
    resolveBackend = resolve
  })
  const identity = '\u2063\u200b'
  const minimized = windowInfo({ minimized: true, caption: `${title}${identity}` })
  const otherWindow = windowInfo({ uuid: 'other', minimized: true })
  const setWindowTitle = nextTitle => {
    title = nextTitle.endsWith(identity) ? nextTitle : `${nextTitle}${identity}`
  }
  const states = []
  const detected = new Promise(resolve => {
    const stop = monitorKdeWaylandWindowState({
      browserWindow,
      backend,
      applyWindowIdentity: () => {
        setWindowTitle(targetWindow().caption)
      },
      detectionDelay: 0,
      pollInterval: 60000,
      onMinimizedState: state => {
        states.push(state)
        stop()
        resolve()
      },
    })
  })

  browserWindow.emit('blur')
  title = targetWindow().caption
  resolveBackend({
    queryWindow: async () => minimized,
    queryWindows: async () => {
      setWindowTitle(targetWindow().caption)
      return [otherWindow, minimized]
    },
    watchActiveWindow: () => ({ activeWindow: null, stop: () => {} }),
  })
  await detected

  assert.deepEqual(states, [true])
})

function windowInfo (overrides = {}) {
  return {
    uuid: 'window',
    caption: 'Subscriptions - OpenTubeX',
    minimized: false,
    pid: 1234,
    width: 1200,
    height: 832,
    ...overrides,
  }
}

function targetWindow () {
  return {
    caption: 'Subscriptions - OpenTubeX',
    bounds: { x: 10, y: 20, width: 1200, height: 800 },
  }
}

async function focusedStatesAfterBlur (
  activeWindow,
  { activeWindowChanges = [], focusHandoffDelay, settleDelay = 10 } = {}
) {
  const browserWindow = new EventEmitter()
  browserWindow.getBounds = () => targetWindow().bounds
  browserWindow.getTitle = () => targetWindow().caption
  browserWindow.isFocused = () => false
  const focusedStates = []
  let activeWindowListener = null
  const backend = Promise.resolve({
    queryWindow: async () => null,
    queryWindows: async () => [windowInfo()],
    watchActiveWindow: listener => {
      activeWindowListener = listener
      return {
        activeWindow,
        stop: () => {
          if (activeWindowListener === listener) activeWindowListener = null
        },
      }
    },
  })
  const stop = monitorKdeWaylandWindowState({
    browserWindow,
    backend,
    detectionDelay: 0,
    focusHandoffDelay,
    onFocusedState: focused => focusedStates.push(focused),
    onMinimizedState: () => {},
  })

  browserWindow.emit('blur')
  await new Promise(resolve => setTimeout(resolve, 10))
  for (const nextActiveWindow of activeWindowChanges) {
    activeWindow = nextActiveWindow
    if (activeWindowListener !== null) activeWindowListener(activeWindow)
    await Promise.resolve()
  }
  await new Promise(resolve => setTimeout(resolve, settleDelay))
  stop()

  return focusedStates
}
