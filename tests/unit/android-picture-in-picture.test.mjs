import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function renderer({ fit = 'contain', rect = { x: 12, y: 60, width: 400, height: 300 } } = {}) {
  const calls = []
  const frames = new Map()
  const timers = new Map()
  let sequence = 0
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
  const document = Object.assign(new EventTarget(), {
    hidden: false, hasFocus: () => true,
    body: { classList: { contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
    querySelectorAll: () => [],
    documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } },
  })
  const window = {
    innerWidth: 480, innerHeight: 800, outerWidth: 480, outerHeight: 800,
    visualViewport: Object.assign(new EventTarget(), { scale: 1 }),
    dispatchEvent: event => {
      if (event.type === 'opentubex:android-pip') api.setAndroidPictureInPictureDocumentState(event.active, event)
      for (const callback of [...(callbacks.get(event.type) ?? [])]) callback(event)
      return true
    },
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
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
  }
  const source = readFileSync(new URL('../../src/renderer/helpers/androidUi.js', import.meta.url), 'utf8')
    .replace(/^import .+$/gm, '').replace(/export /g, '')
  const api = vm.runInNewContext(`${source}\n({ enterAndroidPictureInPicture, setAndroidAutoPictureInPicture, setAndroidPictureInPictureDocumentState })`, context)
  const step = () => {
    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) callback()
    }
  }
  return { ...api, video, calls, rect, classes, attributes, properties, window, document, plugin,
    resize: () => resized?.(), listeners, step, flush: () => { while (frames.size) step() },
    expire: () => { for (const callback of [...timers.values()]) callback() } }
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

test('unchanged PiP bounds skip native updates across observed layout events', async () => {
  const r = renderer()
  await r.setAndroidAutoPictureInPicture(true, r.video)
  r.resize()
  r.flush()
  const count = r.calls.length
  for (const update of [r.resize, r.listeners.get('scroll'), r.listeners.get('resize')]) {
    update()
    r.flush()
    assert.equal(r.calls.length, count)
  }
  r.rect.y += 0.25
  r.resize()
  r.flush()
  assert.equal(r.calls.length, count + 1, 'fractional geometry changes still update the native crop')
})

test('offscreen scrolls skip duplicate crops while viewport conversion changes still update', async () => {
  const r = renderer()
  await r.setAndroidAutoPictureInPicture(true, r.video)
  r.rect.y = -1000
  r.listeners.get('scroll')()
  r.flush()
  const count = r.calls.length
  r.rect.y = -1200
  r.listeners.get('scroll')()
  r.flush()
  assert.equal(r.calls.length, count)
  r.window.innerWidth += 0.25
  r.listeners.get('resize')()
  r.flush()
  assert.equal(r.calls.length, count + 1)
  assert.equal(r.calls.at(-1)[1].sourceRect.viewportWidth, 480.25)
})

test('focus return resends unchanged PiP bounds that native Android may have ignored', async () => {
  const r = renderer()
  await r.setAndroidAutoPictureInPicture(true, r.video)
  r.document.hasFocus = () => false
  r.resize()
  r.flush()
  const count = r.calls.length
  const previous = r.calls.at(-1)[1]
  r.document.hasFocus = () => true
  r.listeners.get('focus')()
  r.flush()
  assert.equal(r.calls.length, count + 1)
  assert.deepEqual(r.calls.at(-1)[1], previous)
})

test('a failed native PiP bounds update retries on the next layout event', async t => {
  const r = renderer()
  t.mock.method(console, 'warn', () => {})
  const update = r.plugin.updatePictureInPictureSourceRect
  let attemptsMade = 0
  const attempts = t.mock.method(r.plugin, 'updatePictureInPictureSourceRect', async options => {
    if (++attemptsMade === 1) throw new Error('Bridge unavailable')
    return update(options)
  })
  await r.setAndroidAutoPictureInPicture(true, r.video)
  r.resize()
  r.flush()
  await new Promise(resolve => setImmediate(resolve))
  r.resize()
  r.flush()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts.mock.callCount(), 2)
  assert.equal(r.calls.at(-1)[0], 'bounds')
})

test('partially offscreen cover video moves into the viewport and retains its object fit', async () => {
  const r = renderer({ fit: 'cover', rect: { x: -10, y: -20, width: 400, height: 225 } })
  const entered = r.enterAndroidPictureInPicture(r.video)
  r.flush()
  await entered
  assert.deepEqual(r.calls.find(([action]) => action === 'enter')[1].sourceRect,
    { x: 0, y: 0, width: 400, height: 225, viewportWidth: 480 })
  assert.equal(r.properties.get('--android-pip-video-fit'), 'cover')
  assert.equal(r.properties.get('--android-pip-source-top'), '0px')
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

for (const [position, y] of [['offscreen', -1000], ['offscreen', 1000], ['partially scrolled', -200], ['partially scrolled', 700]]) {
  test(`${position} automatic PiP keeps the full video crop at y=${y}`, async () => {
    const r = renderer()
    await r.setAndroidAutoPictureInPicture(true, r.video)
    r.rect.y = y
    r.listeners.get('scroll')()
    r.flush()
    const { sourceRect } = r.calls.at(-1)[1]
    assert.ok(sourceRect, 'automatic entry still has a live video crop')
    assert.equal(sourceRect.height, 225, 'PiP must show the whole video, not only its visible strip')
    assert.equal(sourceRect.width, 400)
    assert.ok(sourceRect.y >= 0 && sourceRect.y + sourceRect.height <= r.window.innerHeight)
    r.setAndroidPictureInPictureDocumentState(true, { transitioning: true })
    assert.equal(parseFloat(r.properties.get('--android-pip-source-top')) + 37.5, sourceRect.y,
      'the frozen live video must move with the complete native crop')
  })
}

test('disabling a normal PiP target explicitly clears the native source crop', async () => {
  const r = renderer()
  await r.setAndroidAutoPictureInPicture(true, r.video)
  await r.setAndroidAutoPictureInPicture(false, r.video)
  assert.equal(r.calls.at(-1)[1].sourceRect, null)
})

for (const frames of [0, 1]) {
  test(`backgrounding manual PiP after ${frames} paint frames cannot enter late on return`, async () => {
    const r = renderer()
    const entered = r.enterAndroidPictureInPicture(r.video)
    if (frames) r.step()
    r.document.hidden = true
    r.document.dispatchEvent(new Event('visibilitychange'))
    r.document.hidden = false
    r.flush()
    await entered
    assert.equal(r.calls.filter(([action]) => action === 'enter').length, 0)
  })
}

for (const transitioning of [false, true]) {
  test(`automatic PiP can take over an interrupted manual paint wait (transitioning=${transitioning})`, async () => {
    const r = renderer()
    const entered = r.enterAndroidPictureInPicture(r.video)
    r.window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true, transitioning }))
    r.flush()
    await entered
    assert.equal(r.calls.filter(([action]) => action === 'enter').length, 0)
    assert.ok(r.classes.has('androidPictureInPicture'))
  })
}

test('a foreground manual paint deadline restores the page and prevents a late request', async () => {
  const r = renderer()
  const entered = r.enterAndroidPictureInPicture(r.video)
  r.expire()
  r.flush()
  await entered
  assert.equal(r.calls.filter(([action]) => action === 'enter').length, 0)
  assert.equal(r.classes.has('androidPictureInPicture'), false)
})

test('transient focus loss cancels manual entry and restores the page when focus returns', async () => {
  const r = renderer()
  const entered = r.enterAndroidPictureInPicture(r.video)
  r.document.hasFocus = () => false
  r.listeners.get('blur')()
  await entered
  r.document.hasFocus = () => true
  r.listeners.get('focus')()
  r.flush()
  assert.equal(r.calls.filter(([action]) => action === 'enter').length, 0)
  assert.equal(r.classes.has('androidPictureInPicture'), false)
})

for (const transitioning of [false, true]) {
  test(`native automatic entry cancels the interrupted manual focus fallback (transitioning=${transitioning})`, async () => {
    const r = renderer()
    const entered = r.enterAndroidPictureInPicture(r.video)
    r.document.hasFocus = () => false
    r.listeners.get('blur')()
    await entered
    r.window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true, transitioning }))
    r.document.hasFocus = () => true
    r.listeners.get('focus')()
    r.flush()
    assert.ok(r.classes.has('androidPictureInPicture'))
  })
}

test('restored layout work runs before CSS transitions resume and re-entry cancels obsolete work', async () => {
  const r = renderer()
  await r.setAndroidAutoPictureInPicture(true, r.video)
  let restored = 0
  r.window.addEventListener('opentubex:android-pip-restored', () => {
    assert.ok(r.classes.has('androidPictureInPictureRestoring'))
    restored++
  })
  r.setAndroidPictureInPictureDocumentState(true)
  r.setAndroidPictureInPictureDocumentState(false)
  r.step()
  r.step()
  assert.equal(restored, 1)
  assert.ok(r.classes.has('androidPictureInPictureRestoring'))
  r.flush()
  assert.equal(r.classes.has('androidPictureInPictureRestoring'), false)
  r.setAndroidPictureInPictureDocumentState(true)
  r.setAndroidPictureInPictureDocumentState(false)
  r.step()
  r.setAndroidPictureInPictureDocumentState(true)
  r.flush()
  assert.equal(restored, 1, 'new entry cancels the old restoration')
  assert.ok(r.classes.has('androidPictureInPicture'))
})
