import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import {
  createNativePictureInPictureBounds,
  createPictureInPictureBoundsStore,
  fitPictureInPictureBounds,
  normalizePictureInPictureBounds
} from '../../src/main/pictureInPictureBounds.js'
import dbus from 'dbus-native'
import { EventEmitter } from 'node:events'
import { createKwinPictureInPictureScript, startKwinPictureInPictureBounds } from '../../src/main/kwinPictureInPictureBounds.js'

const display = { x: 0, y: 0, width: 1920, height: 1040 }

test('keeps saved bounds for a video with the same aspect ratio', () => {
  assert.deepEqual(
    fitPictureInPictureBounds({ x: 40, y: 50, width: 640, height: 360 }, { x: 1500, y: 800, width: 384, height: 216 }, [display]),
    { x: 40, y: 50, width: 640, height: 360 }
  )
})

test('moves saved bounds back inside the work area they overlap most', () => {
  const second = { x: 1920, y: 0, width: 1280, height: 1000 }
  assert.deepEqual(
    fitPictureInPictureBounds({ x: 2900, y: 900, width: 640, height: 360 }, { x: 0, y: 0, width: 384, height: 216 }, [display, second]),
    { x: 2560, y: 640, width: 640, height: 360 }
  )
  assert.deepEqual(
    fitPictureInPictureBounds({ x: 0, y: 0, width: 4000, height: 2250 }, { x: 0, y: 0, width: 384, height: 216 }, [display]),
    { x: 71, y: 0, width: 1849, height: 1040 }
  )
})

test('keeps a window in its corner for a video with another aspect ratio', () => {
  const corner = { x: 1520, y: 815, width: 400, height: 225 }
  const portrait = { x: 0, y: 0, width: 225, height: 400 }
  assert.deepEqual(fitPictureInPictureBounds(corner, portrait, [display]), { x: 1695, y: 640, width: 225, height: 400 })
  // A size Chromium chose
  assert.deepEqual(fitPictureInPictureBounds(corner, { x: 0, y: 0, width: 284, height: 400 }, [display], true), { x: 1636, y: 640, width: 284, height: 400 })
  assert.deepEqual(fitPictureInPictureBounds({ ...corner, x: 0, y: 0 }, portrait, [display]), { x: 0, y: 0, width: 225, height: 400 })
})

test('ignores saved bounds on a disconnected display', () => {
  assert.equal(fitPictureInPictureBounds({ x: 2000, y: 50, width: 640, height: 360 }, { x: 0, y: 0, width: 384, height: 216 }, [display]), null)
})

test('the fitting function runs on its own, as KWin script source', () => {
  const fit = new Function(`return ${fitPictureInPictureBounds}`)()
  assert.deepEqual(fit({ x: 40, y: 50, width: 640, height: 360 }, { x: 0, y: 0, width: 384, height: 216 }, [display]), { x: 40, y: 50, width: 640, height: 360 })
})

test('accepts only finite bounds with a size', () => {
  assert.deepEqual(normalizePictureInPictureBounds({ x: -10, y: 5, width: 1, height: 2, extra: true }), { x: -10, y: 5, width: 1, height: 2 })
  for (const value of [null, 'x', { x: 1, y: 2, width: 0, height: 2 }, { x: Number.NaN, y: 0, width: 1, height: 1 }, { x: '1', y: 0, width: 1, height: 1 }]) {
    assert.equal(normalizePictureInPictureBounds(value), null)
  }
})

test('stores the bounds for the next session', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pip-bounds-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'bounds.json')

  assert.equal(await createPictureInPictureBoundsStore(file).load(), null)
  const store = createPictureInPictureBoundsStore(file)
  await store.save({ x: 1, y: 2, width: 3, height: 4 })
  assert.deepEqual(await store.load(), { x: 1, y: 2, width: 3, height: 4 })
  assert.deepEqual(await createPictureInPictureBoundsStore(file).load(), { x: 1, y: 2, width: 3, height: 4 })

  // Quitting waits for the last save
  store.save({ x: 5, y: 6, width: 7, height: 8 })
  await store.settled()
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { x: 5, y: 6, width: 7, height: 8 })

  await writeFile(file, '{')
  t.mock.method(console, 'error', () => {})
  assert.equal(await createPictureInPictureBoundsStore(file).load(), null)
})

function nativeFixture(saved) {
  const calls = []
  const bounds = new Map([[7, { x: 3000, y: 1600, width: 768, height: 432 }]])
  const native = {
    findPictureInPictureWindow: excluded => {
      calls.push(['find', excluded])
      return bounds.size > 0 ? [...bounds.keys()].at(-1) : null
    },
    getWindowBounds: handle => bounds.get(handle) ?? null,
    setWindowBounds: (handle, value) => {
      calls.push(['set', handle, value])
      bounds.set(handle, value)
      return true
    }
  }
  const stored = []
  const store = { load: async () => stored.at(-1) ?? saved, save: value => stored.push(value) }
  const tracker = createNativePictureInPictureBounds({
    native,
    store,
    getWorkAreas: () => [display],
    getExcludedHandles: () => ['main window'],
    // Physical pixels at 200% scaling
    toNative: rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value * 2])),
    fromNative: rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / 2])),
    pollInterval: 100
  })
  return { tracker, calls, bounds, stored, native }
}

test('restores the saved bounds each time the window shows', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { tracker, calls, bounds, stored } = nativeFixture({ x: 40, y: 50, width: 640, height: 360 })
  const page = {}

  await tracker.shown(page)
  assert.deepEqual(calls, [['find', ['main window']], ['set', 7, { x: 80, y: 100, width: 1280, height: 720 }]])

  bounds.set(7, { x: 200, y: 300, width: 800, height: 450 })
  tracker.hidden(page)
  assert.deepEqual(stored, [{ x: 100, y: 150, width: 400, height: 225 }])

  // Windows can reuse a destroyed window's handle for a new window
  bounds.set(7, { x: 3000, y: 1600, width: 768, height: 432 })
  await tracker.shown({})
  assert.deepEqual(calls.at(-1), ['set', 7, { x: 200, y: 300, width: 800, height: 450 }])
})

test('saves only the user\'s changes to the window', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { tracker, calls, bounds, stored, native } = nativeFixture({ x: 1280, y: 680, width: 640, height: 360 })
  const page = {}
  await tracker.shown(page)
  assert.deepEqual(calls.at(-1), ['set', 7, { x: 2560, y: 1360, width: 1280, height: 720 }])

  // Chromium resizes the window for a 4:3 video, and the window stays in its corner
  bounds.set(7, { x: 2560, y: 1360, width: 960, height: 720 })
  t.mock.timers.tick(100)
  assert.deepEqual(calls.at(-1), ['set', 7, { x: 2880, y: 1360, width: 960, height: 720 }])
  t.mock.timers.tick(100)
  tracker.hidden(page)

  // Chromium widens a window for a portrait video to its minimum width right away
  const set = native.setWindowBounds
  native.setWindowBounds = (handle, value) => set(handle, { ...value, width: Math.max(value.width, 800) })
  bounds.set(7, { x: 0, y: 0, width: 432, height: 768 })
  await tracker.shown(page)
  t.mock.timers.tick(100)
  assert.deepEqual(calls.at(-1), ['set', 7, { x: 3040, y: 800, width: 800, height: 1280 }])
  assert.deepEqual(stored, [])

  bounds.set(7, { x: 100, y: 200, width: 800, height: 1280 })
  t.mock.timers.tick(100)
  assert.deepEqual(stored, [{ x: 50, y: 100, width: 400, height: 640 }])
})

test('leaves a window alone without saved bounds or a match', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { tracker, calls, bounds, stored } = nativeFixture(null)
  await tracker.shown({})
  assert.equal(calls.some(([name]) => name === 'set'), false)

  bounds.clear()
  const page = {}
  await tracker.shown(page)
  tracker.hidden(page)
  t.mock.timers.tick(100)
  assert.deepEqual(stored, [])
})

function runKwinScript(saved, windows, owner = { processId: 42, flatpakId: null }) {
  const reports = []
  const added = []
  const workspace = {
    screens: [{ geometry: { x: 0, y: 0, width: 1920, height: 1080 } }],
    currentDesktop: {},
    clientArea: () => ({ ...display }),
    windowList: () => [...windows, ...added.windows].filter(window => window.listed),
    windowAdded: { connect: listener => added.push(listener) }
  }
  added.windows = []
  const source = createKwinPictureInPictureScript({ owner, destination: ':1.5', saved })
  new Function('workspace', 'KWin', 'callDBus', source)(workspace, { MaximizeArea: 2 }, (...args) => reports.push(args))
  return {
    reports,
    add: window => {
      added.windows.push(window)
      added.forEach(listener => listener(window))
    }
  }
}

// Chromium limits its Picture-in-Picture window to part of the screen
const pictureInPictureMaxSize = { width: 1536, height: 864 }
// KWin's maximum size of a window that sets none
const unboundedMaxSize = { width: 2147483647, height: 2147483647 }

function kwinWindow({ pid = 42, keepAbove = false, desktopFileName = '', normalWindow = true, maxSize = pictureInPictureMaxSize, listed = false } = {}) {
  const listeners = {}
  const signal = name => ({
    connect: listener => { listeners[name] = listener },
    disconnect: listener => { if (listeners[name] === listener) delete listeners[name] }
  })
  const window = {
    pid,
    keepAbove,
    onAllDesktops: false,
    desktopFileName,
    normalWindow,
    maxSize,
    listed,
    move: false,
    resize: false,
    assignments: [],
    frameGeometryChanged: signal('frameGeometryChanged'),
    interactiveMoveResizeFinished: signal('interactiveMoveResizeFinished'),
    emit: name => listeners[name]?.(),
    // A geometry change by KWin or Chromium
    change: value => {
      const old = geometry
      geometry = value
      listeners.frameGeometryChanged?.(old)
    }
  }
  let geometry = { x: 516, y: 290, width: 888, height: 500 }
  Object.defineProperty(window, 'frameGeometry', {
    get: () => geometry,
    set: value => {
      window.assignments.push({ ...value })
      geometry = value
    }
  })
  return window
}

test('the KWin script moves, resizes, and keeps above others only the Picture-in-Picture window', () => {
  const pip = kwinWindow()
  const main = kwinWindow({ desktopFileName: 'opentubex', maxSize: unboundedMaxSize, listed: true })
  // A window rule can keep the app's window above others
  const ruled = kwinWindow({ keepAbove: true, desktopFileName: 'opentubex', maxSize: unboundedMaxSize })
  const menu = kwinWindow({ normalWindow: false })
  const other = kwinWindow({ pid: 7 })
  // Electron gives the detached DevTools window no app ID on Wayland
  const devTools = kwinWindow({ maxSize: unboundedMaxSize })
  const { add } = runKwinScript({ x: 40, y: 50, width: 640, height: 360 }, [main])
  for (const window of [ruled, menu, other, devTools, pip]) add(window)

  for (const window of [main, ruled, menu, other, devTools]) {
    assert.deepEqual(window.assignments, [])
    assert.equal(window.onAllDesktops, false)
  }
  for (const window of [main, menu, other, devTools]) assert.equal(window.keepAbove, false)
  assert.equal(pip.keepAbove, true)
  assert.equal(pip.onAllDesktops, true)
  assert.deepEqual(pip.assignments, [
    { x: 40, y: 50, width: 888, height: 500 },
    { x: 40, y: 50, width: 640, height: 360 }
  ])
})

test('the KWin script reports finished moves and reuses them in the session', () => {
  const first = kwinWindow()
  const { add, reports } = runKwinScript(null, [])
  add(first)
  assert.deepEqual(first.assignments, [])

  first.move = true
  first.change({ x: 100.4, y: 120, width: 480, height: 270 })
  assert.deepEqual(reports, [])
  first.move = false
  first.emit('interactiveMoveResizeFinished')
  assert.deepEqual(reports, [[':1.5', '/io/github/OpenTubeX/KWinPictureInPicture', 'io.github.OpenTubeX.KWinPictureInPicture', 'ReportBounds', 100, 120, 480, 270]])

  // KWin creates a new window each time Chromium shows one
  const second = kwinWindow()
  add(second)
  assert.deepEqual(second.assignments.at(-1), { x: 100, y: 120, width: 480, height: 270 })
})

test('the KWin script keeps the saved bounds when the script or Chromium changes the window', () => {
  const pip = kwinWindow()
  const { add, reports } = runKwinScript({ x: 1280, y: 680, width: 640, height: 360 }, [])
  add(pip)
  // Chromium takes the resize the script asked for, then resizes the window
  // for a video with another aspect ratio
  pip.change({ x: 1280, y: 680, width: 640, height: 360 })
  pip.change({ x: 1340, y: 680, width: 480, height: 360 })
  assert.deepEqual(pip.assignments.at(-1), { x: 1440, y: 680, width: 480, height: 360 })
  pip.change(pip.assignments.at(-1))
  assert.deepEqual(reports, [])

  // A move by the user, such as a keyboard shortcut
  pip.change({ x: 20, y: 30, width: 480, height: 360 })
  pip.change({ x: 1440, y: 680, width: 480, height: 360 })
  assert.deepEqual(reports.map(report => report.slice(4)), [[20, 30, 480, 360], [1440, 680, 480, 360]])
})

test('inside Flatpak, the KWin script finds the Picture-in-Picture window by its main window\'s host PID', () => {
  // The sandbox hides the host PID, so the script cannot match process.pid
  const owner = { processId: null, flatpakId: 'org.opentubex.OpenTubeX' }
  const main = kwinWindow({ pid: 9001, desktopFileName: 'org.opentubex.OpenTubeX', listed: true })
  const pip = kwinWindow({ pid: 9001 })
  // Another app's window without an app ID, and one with the same PID as the
  // sandbox sees itself
  const other = kwinWindow({ pid: 7 })
  const sandboxPid = kwinWindow({ pid: 2 })
  const { add } = runKwinScript({ x: 40, y: 50, width: 640, height: 360 }, [main], owner)
  for (const window of [other, sandboxPid, pip]) add(window)

  for (const window of [main, other, sandboxPid]) assert.deepEqual(window.assignments, [])
  assert.deepEqual(pip.assignments.at(-1), { x: 40, y: 50, width: 640, height: 360 })
})

/** A session bus whose KWin accepts or rejects the script. */
function fakeKwinBus(t, { scriptId = 1 } = {}) {
  const originalSessionBus = dbus.sessionBus
  const calls = []
  const bus = { name: ':1.20', connection: new EventEmitter() }
  const scripting = {
    unloadScript: async name => { calls.push(['unloadScript', name]) },
    start: async () => { calls.push(['start']) }
  }
  bus.getService = () => ({ getInterface: async () => scripting })
  bus.exportInterface = () => {}
  bus.invoke = async ({ member, body }) => {
    calls.push([member, ...body, await readFile(body[0], 'utf8')])
    return scriptId
  }
  bus.close = async () => { calls.push(['close']) }
  dbus.sessionBus = () => bus
  t.after(() => { dbus.sessionBus = originalSessionBus })
  return calls
}

test('inside Flatpak, the KWin script is written where the host can read it and removed on close', async t => {
  const runtime = await mkdtemp(path.join(tmpdir(), 'opentubex-runtime-'))
  t.after(() => rm(runtime, { force: true, recursive: true }))
  const shared = path.join(runtime, 'app', 'org.opentubex.OpenTubeX')
  await mkdir(shared, { recursive: true })
  const calls = fakeKwinBus(t)
  const store = { load: async () => null, save: () => {} }

  const close = await startKwinPictureInPictureBounds({
    store,
    environment: { FLATPAK_ID: 'org.opentubex.OpenTubeX', XDG_RUNTIME_DIR: runtime }
  })
  assert.notEqual(close, null)
  const [, file, pluginName, source] = calls.find(([member]) => member === 'loadScript')
  assert.equal(path.dirname(path.dirname(file)), shared)
  assert.equal(pluginName, 'opentubex-picture-in-picture-org.opentubex.OpenTubeX')
  assert.match(source, /other\.desktopFileName === "org\.opentubex\.OpenTubeX"/)
  assert.doesNotMatch(source, /window\.pid === \d/)
  assert.deepEqual(calls[0], ['unloadScript', pluginName])

  await close()
  assert.deepEqual(await readdir(shared), [])
  assert.deepEqual(calls.slice(-2), [['unloadScript', pluginName], ['close']])
})

test('outside Flatpak, the KWin script matches the process ID and is removed when KWin rejects it', async t => {
  const calls = fakeKwinBus(t, { scriptId: -1 })
  const store = { load: async () => null, save: () => {} }

  assert.equal(await startKwinPictureInPictureBounds({ store, environment: {} }), null)
  const [, file, pluginName, source] = calls.find(([member]) => member === 'loadScript')
  assert.equal(path.dirname(path.dirname(file)), tmpdir())
  assert.equal(pluginName, `opentubex-picture-in-picture-${process.pid}`)
  assert.match(source, new RegExp(`window\\.pid === ${process.pid}`))
  await assert.rejects(readFile(file), { code: 'ENOENT' })
  await assert.rejects(readdir(path.dirname(file)), { code: 'ENOENT' })
  assert.deepEqual(calls.at(-1), ['close'])
})
