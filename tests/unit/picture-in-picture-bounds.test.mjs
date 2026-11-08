import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import {
  createNativePictureInPictureBounds,
  createPictureInPictureBoundsStore,
  fitPictureInPictureBounds,
  normalizePictureInPictureBounds
} from '../../src/main/pictureInPictureBounds.js'
import { createKwinPictureInPictureScript } from '../../src/main/kwinPictureInPictureBounds.js'

const display = { x: 0, y: 0, width: 1920, height: 1040 }

test('keeps saved bounds for a video with the same aspect ratio', () => {
  assert.deepEqual(
    fitPictureInPictureBounds({ x: 40, y: 50, width: 640, height: 360 }, { x: 1500, y: 800, width: 384, height: 216 }, [display]),
    { x: 40, y: 50, width: 640, height: 360 }
  )
})

test('keeps the saved area for a video with another aspect ratio', () => {
  assert.deepEqual(
    fitPictureInPictureBounds({ x: 40, y: 50, width: 640, height: 360 }, { x: 1500, y: 800, width: 300, height: 300 }, [display]),
    { x: 40, y: 50, width: 480, height: 480 }
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
    { x: 0, y: 0, width: 1849, height: 1040 }
  )
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
  const store = { load: async () => saved, save: value => stored.push(value) }
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
  return { tracker, calls, bounds, stored }
}

test('restores saved bounds once per native window', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { tracker, calls, bounds, stored } = nativeFixture({ x: 40, y: 50, width: 640, height: 360 })
  const page = {}

  await tracker.shown(page)
  assert.deepEqual(calls, [['find', ['main window']], ['set', 7, { x: 80, y: 100, width: 1280, height: 720 }]])

  // Chromium remembers where the window was moved while it exists
  bounds.set(7, { x: 200, y: 300, width: 800, height: 450 })
  tracker.hidden(page)
  assert.deepEqual(stored, [{ x: 100, y: 150, width: 400, height: 225 }])
  await tracker.shown(page)
  assert.equal(calls.filter(([name]) => name === 'set').length, 1)
  tracker.hidden(page)

  // A window for another page gets the saved bounds again
  bounds.set(8, { x: 0, y: 0, width: 768, height: 432 })
  await tracker.shown({})
  assert.deepEqual(calls.at(-1), ['set', 8, { x: 80, y: 100, width: 1280, height: 720 }])
})

test('saves moves while the window shows, for a window closed from the system', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { tracker, bounds, stored } = nativeFixture(null)
  const page = {}
  await tracker.shown(page)

  t.mock.timers.tick(100)
  assert.deepEqual(stored, [{ x: 1500, y: 800, width: 384, height: 216 }])
  t.mock.timers.tick(100)
  assert.equal(stored.length, 1)

  bounds.set(7, { x: 100, y: 200, width: 768, height: 432 })
  t.mock.timers.tick(100)
  bounds.delete(7)
  t.mock.timers.tick(100)
  tracker.hidden(page)
  assert.deepEqual(stored.at(-1), { x: 50, y: 100, width: 384, height: 216 })
  assert.equal(stored.length, 2)
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

function runKwinScript(saved, windows) {
  const reports = []
  const added = []
  const workspace = {
    screens: [{}],
    currentDesktop: {},
    clientArea: () => ({ ...display }),
    windowList: () => windows.filter(window => window.listed),
    windowAdded: { connect: listener => added.push(listener) }
  }
  const source = createKwinPictureInPictureScript({ processId: 42, destination: ':1.5', saved })
  new Function('workspace', 'KWin', 'callDBus', source)(workspace, { MaximizeArea: 2 }, (...args) => reports.push(args))
  return { reports, add: window => added.forEach(listener => listener(window)) }
}

function kwinWindow({ pid = 42, keepAbove = false, desktopFileName = '', normalWindow = true, listed = false } = {}) {
  const listeners = {}
  const signal = name => ({
    connect: listener => { listeners[name] = listener },
    disconnect: listener => { if (listeners[name] === listener) delete listeners[name] }
  })
  const window = {
    pid,
    keepAbove,
    desktopFileName,
    normalWindow,
    listed,
    move: false,
    resize: false,
    assignments: [],
    frameGeometryChanged: signal('frameGeometryChanged'),
    interactiveMoveResizeFinished: signal('interactiveMoveResizeFinished'),
    emit: name => listeners[name]?.()
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

test('the KWin script moves, then resizes, only the Picture-in-Picture window', () => {
  const pip = kwinWindow()
  const main = kwinWindow({ desktopFileName: 'opentubex', listed: true })
  // A window rule can keep the app's window above others
  const ruled = kwinWindow({ keepAbove: true, desktopFileName: 'opentubex' })
  const menu = kwinWindow({ normalWindow: false })
  const other = kwinWindow({ pid: 7 })
  const { add } = runKwinScript({ x: 40, y: 50, width: 640, height: 360 }, [main])
  for (const window of [ruled, menu, other, pip]) add(window)

  for (const window of [main, ruled, menu, other]) assert.deepEqual(window.assignments, [])
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
  first.frameGeometry = { x: 100.4, y: 120, width: 480, height: 270 }
  first.emit('frameGeometryChanged')
  assert.deepEqual(reports, [])
  first.move = false
  first.emit('interactiveMoveResizeFinished')
  assert.deepEqual(reports, [[':1.5', '/io/github/OpenTubeX/KWinPictureInPicture', 'io.github.OpenTubeX.KWinPictureInPicture', 'ReportBounds', 100, 120, 480, 270]])

  // KWin creates a new window each time Chromium shows one
  const second = kwinWindow()
  add(second)
  assert.deepEqual(second.assignments.at(-1), { x: 100, y: 120, width: 480, height: 270 })
})
