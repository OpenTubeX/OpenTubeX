import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function renderer({ fit = 'contain', rect = { x: 12, y: 60, width: 400, height: 300 } } = {}) {
  const calls = []
  const frames = []
  const listeners = new Map()
  const callbacks = new Map()
  const classes = new Set()
  const attributes = new Set()
  const properties = new Map()
  const player = {
    setAttribute: name => attributes.add(name), removeAttribute: name => attributes.delete(name),
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => rect,
  }
  const video = Object.assign(new EventTarget(), {
    videoWidth: 1920, videoHeight: 1080, getBoundingClientRect: () => rect, closest: () => player,
  })
  let resized
  const plugin = {
    enterPictureInPicture: async options => calls.push(['enter', structuredClone(options)]),
    setAutoPictureInPicture: async options => calls.push(['auto', structuredClone(options)]),
    updatePictureInPictureSourceRect: async options => calls.push(['bounds', structuredClone(options)]),
  }
  const document = {
    body: { classList: { contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
    querySelectorAll: () => [],
    documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } },
  }
  const window = {
    innerWidth: 480, innerHeight: 800, outerWidth: 480, outerHeight: 800,
    visualViewport: Object.assign(new EventTarget(), { scale: 1 }),
    dispatchEvent: event => api.setAndroidPictureInPictureDocumentState(event.active, event),
    addEventListener: (name, callback) => {
      if (!callbacks.has(name)) callbacks.set(name, new Set())
      callbacks.get(name).add(callback)
      listeners.set(name, () => { for (const callback of [...callbacks.get(name)]) callback() })
    },
    removeEventListener: (name, callback) => {
      callbacks.get(name)?.delete(callback)
      if (!callbacks.get(name)?.size) listeners.delete(name)
    },
  }
  const context = {
    document, window, console, Event, process: { env: { IS_CAPACITOR: true } },
    registerPlugin: () => plugin, getComputedStyle: () => ({ objectFit: fit }),
    ResizeObserver: class {
      constructor(callback) { resized = callback }
      observe() {} disconnect() { resized = null }
    },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length },
    cancelAnimationFrame() {},
  }
  const source = readFileSync(new URL('../../src/renderer/helpers/androidUi.js', import.meta.url), 'utf8')
    .replace(/^import .+$/gm, '').replace(/export /g, '')
  const api = vm.runInNewContext(`${source}\n({ enterAndroidPictureInPicture, setAndroidAutoPictureInPicture, setAndroidPictureInPictureDocumentState })`, context)
  return { ...api, video, calls, rect, classes, attributes, properties, window, resize: () => resized?.(), listeners, flush: () => { while (frames.length) frames.shift()() } }
}

test('manual PiP keeps the live source layout until the native mode callback, and restores without motion', async () => {
  const r = renderer()
  const entered = r.enterAndroidPictureInPicture(r.video)
  r.flush()
  await entered
  assert.ok(r.classes.has('androidPictureInPictureEntering'))
  r.window.outerWidth = 228
  r.window.outerHeight = 128
  r.listeners.get('resize')?.()
  assert.ok(r.classes.has('androidPictureInPictureEntering'), 'viewport changes must not end the native transition')
  r.setAndroidPictureInPictureDocumentState(true)
  assert.equal(r.classes.has('androidPictureInPictureEntering'), false)
  r.setAndroidPictureInPictureDocumentState(false)
  assert.ok(r.classes.has('androidPictureInPictureRestoring'))
  r.flush()
  assert.equal(r.classes.has('androidPictureInPictureRestoring'), false)
})

test('manual Android PiP captures visible content bounds while preserving the entire video element', async () => {
  const r = renderer()
  const entered = r.enterAndroidPictureInPicture(r.video)
  assert.equal(r.calls.length, 0, 'paint the video-only page before native entry')
  assert.deepEqual(Object.fromEntries(r.properties), {
    '--android-pip-source-left': '12px', '--android-pip-source-top': '60px',
    '--android-pip-source-width': '400px', '--android-pip-source-height': '300px',
    '--android-pip-video-fit': 'contain',
  }, 'freeze the video box before native insets can move it')
  r.flush()
  await entered
  assert.deepEqual(r.calls.find(([action]) => action === 'enter')[1].sourceRect,
    { x: 12, y: 97.5, width: 400, height: 225, viewportWidth: 480 })
})

test('automatic Android PiP tracks scrolling and resized video bounds, preserving the return target in PiP', async () => {
  const r = renderer()
  await r.setAndroidAutoPictureInPicture(true, r.video)
  r.rect.y = 20
  r.listeners.get('scroll')?.()
  r.flush()
  assert.equal(r.calls.at(-1)[1].sourceRect?.y, 57.5)
  r.setAndroidPictureInPictureDocumentState(true)
  const count = r.calls.length
  r.rect.width = 200
  r.resize()
  r.flush()
  assert.equal(r.calls.length, count, 'PiP geometry must not overwrite the in-app return target')
  r.setAndroidPictureInPictureDocumentState(false)
  r.flush()
  assert.equal(r.calls.at(-1)[1].sourceRect.width, 200)
  await r.setAndroidAutoPictureInPicture(false, r.video)
  assert.equal(r.listeners.has('scroll'), false)
})

test('cover video bounds are clipped to the visible viewport and retain their object fit', async () => {
  const r = renderer({ fit: 'cover', rect: { x: -10, y: -20, width: 400, height: 225 } })
  const entered = r.enterAndroidPictureInPicture(r.video)
  r.flush()
  await entered
  assert.deepEqual(r.calls.find(([action]) => action === 'enter')[1].sourceRect,
    { x: 0, y: 0, width: 390, height: 205, viewportWidth: 480 })
  assert.equal(r.properties.get('--android-pip-video-fit'), 'cover')
  assert.equal(r.properties.get('--android-pip-source-top'), '-20px')
})

test('native entry and resize callbacks never change the live video geometry or multiply its UI scale', async () => {
  const r = renderer()
  r.window.outerWidth = 600
  await r.setAndroidAutoPictureInPicture(true, r.video)
  r.setAndroidPictureInPictureDocumentState(true, { transitioning: true })
  const original = [...r.properties]
  r.rect.x = 0
  r.rect.y = 0
  r.rect.width = 228
  r.rect.height = 128
  for (const width of [228, 320, 228]) {
    r.window.outerWidth = width
    r.window.outerHeight = width * 9 / 16
    r.setAndroidPictureInPictureDocumentState(true, { transitioning: true })
    r.setAndroidPictureInPictureDocumentState(true, { windowWidth: width, windowHeight: width * 9 / 16 })
    r.listeners.get('resize')?.()
    r.flush()
    assert.deepEqual([...r.properties], original, 'native scaling must preserve the original CSS video box')
  }
  assert.equal(r.properties.get('--android-pip-source-width'), '400px')
  assert.equal(r.properties.get('--android-pip-source-top'), '60px')
})

test('disabling automatic entry while already in PiP retains the manual video target', async () => {
  const r = renderer()
  await r.setAndroidAutoPictureInPicture(true, r.video)
  r.setAndroidPictureInPictureDocumentState(true)
  await r.setAndroidAutoPictureInPicture(false, r.video)
  assert.ok(r.attributes.has('data-android-picture-in-picture-target'))
  assert.ok(r.listeners.has('scroll'), 'keep observing the return destination')
  r.setAndroidPictureInPictureDocumentState(false)
  r.flush()
  await r.setAndroidAutoPictureInPicture(false, r.video)
  assert.equal(r.attributes.has('data-android-picture-in-picture-target'), false)
})
