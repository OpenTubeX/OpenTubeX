import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Capacitor } from '@capacitor/core'
import { nextTick, ref, shallowRef } from 'vue'

// Register the plugins against a native bridge so their real proxies call our mocks.
globalThis.androidBridge = {}
Capacitor.PluginHeaders = [
  { name: 'Screenshot', methods: [{ name: 'take', rtype: 'promise' }] },
  { name: 'Filesystem', methods: [{ name: 'deleteFile', rtype: 'promise' }] },
]
Capacitor.nativePromise = async () => {}
const {
  captureBeforeTabOrganizer,
  getCapacitorTabPreview,
  initializeCapacitorTabPreviews,
} = await import('../../src/renderer/tabs/capacitorTabPreviews.js')
delete globalThis.androidBridge

function setup(t, { cleanupError, decodeError, videos = [] } = {}) {
  const preview = 'data:image/jpeg;base64,cHJldmlldw=='
  let captureImage = preview
  const uri = '/cache/temporary-screenshot.jpg'
  const tab = { id: 'tab', route: { fullPath: '/home' }, loadState: 'loaded' }
  const store = { getters: {
    getShowTabPreviews: true,
    getPresentedTab: tab,
    getPresentedTabId: tab.id,
    getActiveTabId: tab.id,
    getTabs: [tab],
  } }
  const document = new EventTarget()
  let overlayReads = 0
  const drawImage = t.mock.fn(source => {
    if (videos.includes(source)) throw new DOMException('The video has no decoded frame', 'InvalidStateError')
  })
  Object.assign(document, {
    visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: selector => {
      if (selector.includes('[role=')) overlayReads += 1
      if (selector.includes('video')) return videos
      return []
    },
    createElement: () => ({
      getContext: () => ({ drawImage, fillRect() {} }),
      toDataURL: () => captureImage,
    }),
  })
  const globals = {
    document,
    window: Object.assign(new EventTarget(), { innerWidth: 375, innerHeight: 700 }),
    Image: class {
      width = 750
      height = 1400
      async decode() { if (decodeError) throw decodeError }
    },
  }
  const restoreGlobals = []
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    restoreGlobals.push(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else delete globalThis[name]
    })
  }
  const originalNative = process.env.IS_CAPACITOR
  process.env.IS_CAPACITOR = 'true'
  t.after(() => {
    if (originalNative === undefined) delete process.env.IS_CAPACITOR
    else process.env.IS_CAPACITOR = originalNative
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(Capacitor, 'isPluginAvailable', () => true)
  t.mock.method(Capacitor, 'convertFileSrc', value => value)
  const take = t.mock.fn(async () => {
    if (decodeError) throw decodeError
    return { dataUrl: captureImage }
  })
  const remove = t.mock.fn(async () => {
    if (cleanupError) throw cleanupError
  })
  t.mock.method(Capacitor, 'nativePromise', async (plugin, method, options) => {
    if (plugin === 'Screenshot' && method === 'take') return take(options)
    if (plugin === 'Filesystem' && method === 'deleteFile') return remove(options)
    assert.fail(`Unexpected native call: ${plugin}.${method}`)
  })
  const warn = t.mock.method(console, 'warn', () => {})
  const pageSwipe = shallowRef(null)
  const dispose = initializeCapacitorTabPreviews(store, pageSwipe)
  t.after(() => {
    dispose()
    for (const restore of restoreGlobals) restore()
  })
  overlayReads = 0
  return { document, store, tab, preview, uri, take, remove, warn, drawImage, pageSwipe,
    setCaptureImage: image => { captureImage = image }, overlayReads: () => overlayReads }
}

for (const event of ['loadeddata', 'playing', 'seeked']) {
  test(`${event} replaces a cached loading screenshot before the organizer opens`, async t => {
    const state = setup(t)
    t.mock.timers.tick(600)
    await new Promise(setImmediate)
    assert.equal(getCapacitorTabPreview(state.tab), state.preview)

    const frame = 'data:image/jpeg;base64,bmF0aXZlLWZyYW1l'
    state.setCaptureImage(frame)
    state.document.dispatchEvent(new Event(event))
    t.mock.timers.tick(600)
    await new Promise(setImmediate)

    assert.equal(getCapacitorTabPreview(state.tab), frame)
    assert.equal(state.take.mock.callCount(), 2)
  })
}

for (const playback of [
  { name: 'playing', ready: true, playing: true, paused: false, width: 1920, height: 1080 },
  { name: 'paused', ready: true, playing: false, paused: true, width: 1920, height: 1080 },
  { name: 'loading', ready: false },
  { name: 'audio-only', ready: true, width: 0, height: 0 },
]) {
  test(`watch previews use the window screenshot during ${playback.name} playback`, async t => {
    const video = Object.assign(new EventTarget(), {
      style: {},
      paused: playback.paused ?? true,
      readyState: playback.ready ? 4 : 0,
      videoWidth: playback.width ?? 0,
      videoHeight: playback.height ?? 0,
      pause() {},
      getBoundingClientRect: () => ({ left: 0, top: 56, bottom: 267, width: 375, height: 211 }),
    })
    const state = setup(t, { videos: [video] })
    state.tab.route.fullPath = '/watch/test-video'

    await captureBeforeTabOrganizer()

    assert.equal(getCapacitorTabPreview(state.tab), state.preview)
    assert.equal(state.drawImage.mock.callCount(), 0)
    assert.equal(state.remove.mock.callCount(), 0)
    assert.equal(state.warn.mock.callCount(), 0)
  })
}

test('native thumbnails are bounded and require no renderer encoding or temporary file', async t => {
  const state = setup(t)
  await captureBeforeTabOrganizer()
  assert.equal(getCapacitorTabPreview(state.tab), state.preview)
  assert.deepEqual(state.take.mock.calls[0].arguments, [{ width: 375, height: 211, top: 0, cropHeight: (375 * 9 / 16) / 700 }])
  assert.equal(state.drawImage.mock.callCount(), 0)
  assert.equal(state.remove.mock.callCount(), 0)
})

test('compact capture starts below fixed phone controls', async t => {
  const state = setup(t)
  state.document.querySelector = selector => {
    const bounds = {
      '.topNav': { width: 375, bottom: 60.25 },
      '.app.capacitorPhoneLayout > .sideNav': { width: 375, top: 640.5 },
    }[selector]
    return bounds ? { getBoundingClientRect: () => bounds } : null
  }
  await captureBeforeTabOrganizer()
  assert.deepEqual(state.take.mock.calls[0].arguments, [{ width: 375, height: 211, top: 60.25 / 700, cropHeight: (375 * 9 / 16) / 700 }])
})

for (const height of [700, 220]) {
  test(`wide phone capture ignores vertical navigation at ${height}px viewport height`, async t => {
    const state = setup(t)
    window.innerWidth = 900
    window.innerHeight = height
    state.document.querySelector = selector => {
      const bounds = {
        '.topNav': { width: 900, bottom: 60.25 },
        '.app.capacitorPhoneLayout > .sideNav': { width: 200, top: 60.25 },
      }[selector]
      return bounds ? { getBoundingClientRect: () => bounds } : null
    }
    await captureBeforeTabOrganizer()
    const cropHeight = Math.min(height - 60.25, 900 * 9 / 16)
    assert.equal(getCapacitorTabPreview(state.tab), state.preview)
    assert.deepEqual(state.take.mock.calls[0].arguments, [{ width: 640,
      height: Math.round(640 * cropHeight / 900), top: 60.25 / height, cropHeight: cropHeight / height }])
  })
}

test('fractional full-width bottom controls remain outside a short capture', async t => {
  const state = setup(t)
  window.innerWidth = 376
  window.innerHeight = 150
  state.document.querySelector = selector => {
    const bounds = {
      '.topNav': { width: 375.5, bottom: 60.25 },
      '.app.capacitorPhoneLayout > .sideNav': { width: 375.5, top: 125.5 },
    }[selector]
    return bounds ? { getBoundingClientRect: () => bounds } : null
  }
  await captureBeforeTabOrganizer()
  assert.deepEqual(state.take.mock.calls[0].arguments, [{ width: 376, height: 65,
    top: 60.25 / 150, cropHeight: 65.25 / 150 }])
})

test('failed native capture leaves the cache empty', async t => {
  const error = new Error('Capture failed')
  const state = setup(t, { decodeError: error })
  await captureBeforeTabOrganizer()
  assert.equal(getCapacitorTabPreview(state.tab), null)
  assert.equal(state.warn.mock.calls.at(-1).arguments[1], error)
})

test('scroll events defer overlay reads and native capture until scrolling settles', async t => {
  const state = setup(t)
  for (let i = 0; i < 5; i += 1) {
    state.document.dispatchEvent(new Event('scroll'))
    t.mock.timers.tick(100)
  }
  assert.equal(state.overlayReads(), 0)
  assert.equal(state.take.mock.callCount(), 0)
  t.mock.timers.tick(499)
  assert.equal(state.overlayReads(), 0)
  t.mock.timers.tick(1)
  await new Promise(setImmediate)
  assert.equal(state.take.mock.callCount(), 1)
  assert.ok(state.overlayReads() > 0)
  assert.equal(getCapacitorTabPreview(state.tab), state.preview)
})

test('a scheduled capture rechecks whether previews are enabled', async t => {
  const state = setup(t)
  state.document.dispatchEvent(new Event('scroll'))
  state.store.getters.getShowTabPreviews = false
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
  assert.equal(state.take.mock.callCount(), 0)
  assert.equal(getCapacitorTabPreview(state.tab), null)
})

test('a held header swipe cannot cache a partial page preview', async t => {
  const state = setup(t)
  state.pageSwipe.value = { fromId: 'tab', toId: 'neighbor', settling: false }
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
  assert.equal(state.take.mock.callCount(), 0)
  assert.equal(getCapacitorTabPreview(state.tab), null)

  state.pageSwipe.value = { ...state.pageSwipe.value, settling: true }
  await captureBeforeTabOrganizer()
  assert.equal(state.take.mock.callCount(), 0, 'settling pages must not enter the organizer cache')

  state.pageSwipe.value = null
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
  assert.equal(state.take.mock.callCount(), 1, 'capture resumes after the page is stable')
  assert.equal(getCapacitorTabPreview(state.tab), state.preview)
})

test('starting and cancelling a swipe discards an in-flight partial screenshot', async t => {
  const state = setup(t)
  let resolve
  t.mock.method(Capacitor, 'nativePromise', () => new Promise(done => { resolve = done }))
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
  assert.equal(typeof resolve, 'function')
  state.pageSwipe.value = { fromId: 'tab', toId: 'neighbor' }
  state.pageSwipe.value = null
  resolve({ dataUrl: state.preview })
  await new Promise(setImmediate)
  assert.equal(getCapacitorTabPreview(state.tab), null)
})

test('capture resumes when an invalidated screenshot outlasts the post-swipe timer', async t => {
  const state = setup(t)
  let resolve
  let calls = 0
  t.mock.method(Capacitor, 'nativePromise', () => {
    calls += 1
    return calls === 1
      ? new Promise(done => { resolve = done })
      : Promise.resolve({ dataUrl: state.preview })
  })
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
  state.pageSwipe.value = { fromId: 'tab', toId: 'neighbor' }
  state.pageSwipe.value = null
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
  resolve({ dataUrl: 'partial swipe screenshot' })
  await new Promise(setImmediate)
  assert.equal(calls, 2, 'the stable page needs a fresh native capture')
  assert.equal(getCapacitorTabPreview(state.tab), state.preview)
})

for (const cancellation of ['none', 'direct', 'pointercancel']) {
  const cancelled = cancellation !== 'none'
  test(`organizer pull captures before showing the overlay (cancellation: ${cancellation})`, async t => {
    const state = setup(t)
    await captureBeforeTabOrganizer()
    assert.equal(getCapacitorTabPreview(state.tab), state.preview)
    let finishCapture
    const latest = 'data:image/jpeg;base64,bGF0ZXN0'
    state.take.mock.mockImplementation(() => new Promise(resolve => { finishCapture = () => resolve({ dataUrl: latest }) }))
    const open = ref(false)
    state.document.querySelector = selector => selector === '.app > .routerView' ? {} : null
    state.document.querySelectorAll = () => open.value ? [{ getBoundingClientRect: () => ({ width: 375 }) }] : []
    const source = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
    const methods = source.slice(source.indexOf('let organizerTransition ='), source.indexOf('defineExpose({ organizerSwipe })'))
    const updates = []
    const ctx = vm.createContext({
      props: { enabled: true }, open, openingSwitcher: false, disposed: false,
      document: state.document, window: globalThis.window,
      organizerGesture: ref(false), skipDialogTransition: ref(false), activeView: ref('open'),
      captureBeforeTabOrganizer, nextTick, presentedTabId: ref('tab'), CSS: { escape: value => value },
      dialogRef: { value: { querySelector: () => ({ querySelector: () => ({}) }), closest: () => ({}) } },
      openTabsScrollRef: ref(null), organizerSwipeProgress: distance => distance / 320,
      createOrganizerSwipeAnimation: () => ({ update: value => updates.push(value), dispose() {}, finish: async () => {} }),
    })
    const gesture = vm.runInContext(`${methods}; organizerSwipe`, ctx)
    assert.equal(gesture.begin(), true)
    assert.equal(open.value, false, 'the native capture must see the page, not the organizer')
    await new Promise(setImmediate)
    assert.ok(finishCapture, 'the gesture must refresh the cached screenshot')
    gesture.update(160)
    if (cancellation === 'direct') gesture.cancel()
    if (cancellation === 'pointercancel') {
      let finished = false
      const finish = gesture.finish(20, true).then(() => { finished = true })
      try {
        await new Promise(setImmediate)
        assert.equal(finished, true, 'pointer cancellation must finish without waiting for native capture')
      } finally {
        finishCapture()
        await finish
      }
    } else finishCapture()
    await new Promise(setImmediate)
    assert.equal(open.value, !cancelled, 'a late native result cannot reopen a cancelled organizer')
    assert.equal(getCapacitorTabPreview(state.tab), latest)
    assert.deepEqual(updates, cancelled ? [] : [0.5], 'pending capture must retain the latest finger position')
  })
}
