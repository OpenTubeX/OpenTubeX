import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, reactive, ref, shallowRef } from 'vue'
import { createFilesystem, filesystemPluginHeader } from '../helpers/capacitor-filesystem.mjs'

const appSource = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const initializePreviews = appSource.match(/initializeCapacitorTabPreviews\(store, [^\n]+/)[0]

// Register the plugins against a native bridge so their real proxies call our mocks.
globalThis.androidBridge = {}
Capacitor.PluginHeaders = [
  { name: 'Screenshot', methods: [{ name: 'take', rtype: 'promise' }] },
  filesystemPluginHeader,
]
Capacitor.nativePromise = async () => {}
const {
  clearCapacitorTabImages,
  prepareForTabOrganizer,
  getCapacitorTabPreview,
  initializeCapacitorTabPreviews,
} = await import('../../src/renderer/tabs/capacitorTabPreviews.js')
delete globalThis.androidBridge

function setup(t, { decodeError, videos = [], filesystem } = {}) {
  const preview = 'data:image/jpeg;base64,cHJldmlldw=='
  let captureImage = preview
  const uri = '/cache/temporary-screenshot.jpg'
  const tab = { id: 'tab', route: { fullPath: '/home' }, loadState: 'loaded' }
  const store = {
    getters: reactive({
      getShowTabPreviews: true,
      getPresentedTab: tab,
      getPresentedTabId: tab.id,
      getActiveTabId: tab.id,
      getTabs: [tab],
    })
  }
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
    matchMedia: query => ({ matches: query === '(width <= 680px)' && window.innerWidth <= 680 }),
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
  const remove = t.mock.fn(async () => {})
  filesystem ??= createFilesystem(remove)
  t.mock.method(Capacitor, 'nativePromise', async (plugin, method, options) => {
    if (plugin === 'Screenshot' && method === 'take') return take(options)
    if (plugin === 'Filesystem') return filesystem.call(method, options)
    assert.fail(`Unexpected native call: ${plugin}.${method}`)
  })
  const warn = t.mock.method(console, 'warn', () => {})
  const pageSwipe = shallowRef(null)
  const organizerSwipeActive = ref(false)
  const organizerPrewarming = ref(false)
  const loadingTabs = new Set()
  const navigation = { isTabLoading: tabId => loadingTabs.has(tabId) }
  const dispose = vm.runInNewContext(initializePreviews, {
    initializeCapacitorTabPreviews, store, pageSwipe, organizerSwipeActive, organizerPrewarming, computed, navigation, tabsReady: Promise.resolve(),
  })
  t.after(() => {
    dispose()
    for (const restore of restoreGlobals) restore()
  })
  overlayReads = 0
  return {
    document,
    store,
    tab,
    preview,
    uri,
    take,
    remove,
    warn,
    filesystem,
    dispose,
    drawImage,
    pageSwipe,
    organizerSwipeActive,
    loadingTabs,
    setCaptureImage: image => { captureImage = image },
    overlayReads: () => overlayReads
  }
}

async function captureScheduledPreview(t) {
  t.mock.timers.tick(600)
  await new Promise(setImmediate)
}

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

/** Runs the phone tab organizer's gesture methods against a stubbed component. */
function loadOrganizerSwipe(document, open, updates) {
  const source = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
  const methods = source.slice(source.indexOf('let organizerTransition ='), source.indexOf('defineExpose({ organizerSwipe })'))
  const ctx = vm.createContext({
    props: { enabled: true },
    open,
    disposed: false,
    document,
    window: globalThis.window,
    organizerGesture: ref(false),
    skipDialogTransition: ref(false),
    activeView: ref('open'),
    prepareForTabOrganizer,
    nextTick,
    requestAnimationFrame: callback => setImmediate(callback),
    presentedTabId: ref('tab'),
    CSS: { escape: value => value },
    dialogRef: { value: { querySelector: () => ({ querySelector: () => ({}) }), closest: () => ({}) } },
    openTabsScrollRef: ref(null),
    organizerSwipeProgress: distance => distance / 320,
    createOrganizerSwipeAnimation: () => ({ update: value => updates.push(value), dispose() {}, finish: async () => {} }),
  })
  return vm.runInContext(`${methods}; organizerSwipe`, ctx)
}

for (const cancellation of ['none', 'direct', 'pointercancel']) {
  const cancelled = cancellation !== 'none'
  test(`organizer pull reuses its cached preview without waiting for an in-flight capture (cancellation: ${cancellation})`, async t => {
    const state = setup(t)
    await captureScheduledPreview(t)
    assert.equal(getCapacitorTabPreview(state.tab), state.preview)
    let finishCapture
    const latest = 'data:image/jpeg;base64,bGF0ZXN0'
    state.take.mock.mockImplementation(() => new Promise(resolve => { finishCapture = () => resolve({ dataUrl: latest }) }))
    state.document.dispatchEvent(new Event('scroll'))
    await captureScheduledPreview(t)
    assert.ok(finishCapture, 'a background capture is still pending')
    const open = ref(false)
    state.document.querySelector = selector => selector === '.app > .routerView' ? {} : null
    state.document.querySelectorAll = () => open.value ? [{ getBoundingClientRect: () => ({ width: 375 }) }] : []
    const updates = []
    const gesture = loadOrganizerSwipe(state.document, open, updates)
    assert.equal(gesture.begin(), true)
    assert.equal(open.value, true, 'the organizer opens synchronously using the cached preview')
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
    assert.equal(getCapacitorTabPreview(state.tab), state.preview, 'late capture must not overwrite the cached preview')
    assert.equal(state.take.mock.callCount(), 2, 'opening does not request another screenshot')
    assert.deepEqual(updates, cancelled ? [] : [0.5], 'layout preparation retains the latest finger position')
  })
}

// The app draws the organizer once after launch. Opening it meanwhile must
// still work, and the prewarm must not close the real organizer.
test('opening the organizer during its prewarm takes over', async t => {
  const state = setup(t)
  const open = ref(false)
  state.document.querySelector = selector => selector === '.app > .routerView' ? {} : null
  const updates = []
  const gesture = loadOrganizerSwipe(state.document, open, updates)
  const prewarm = gesture.prewarm()
  assert.equal(open.value, true)
  assert.equal(gesture.begin(), true, 'a real opening is not ignored')
  gesture.update(160)
  await prewarm
  await new Promise(setImmediate)
  assert.equal(open.value, true, 'the prewarm leaves the real organizer open')
  assert.deepEqual(updates, [0.5])

  gesture.cancel()
  await gesture.prewarm()
  assert.equal(open.value, false, 'the prewarm closes the organizer it opened')
  assert.ok(updates.at(-1) > 0 && updates.at(-1) < 0.01, 'the prewarm opens the organizer only a little')
})

test('captured previews are restored after the app restarts', async t => {
  const state = setup(t)
  await captureScheduledPreview(t)
  assert.equal(state.filesystem.files.size, 1)
  state.dispose()
  assert.equal(getCapacitorTabPreview(state.tab), null)

  const dispose = initializeCapacitorTabPreviews(state.store, shallowRef(null), Promise.resolve())
  await new Promise(setImmediate)
  assert.equal(getCapacitorTabPreview(state.tab), state.preview)
  assert.equal(state.take.mock.callCount(), 1, 'the restored preview needs no new screenshot')
  dispose()
})

test('restored previews of closed or navigated tabs are deleted', async t => {
  const state = setup(t)
  await captureScheduledPreview(t)
  state.dispose()
  state.tab.route.fullPath = '/history'

  const dispose = initializeCapacitorTabPreviews(state.store, shallowRef(null), Promise.resolve())
  await new Promise(setImmediate)
  assert.equal(getCapacitorTabPreview(state.tab), null)
  assert.equal(state.filesystem.files.size, 0)
  dispose()
})

test('closing a tab and disabling previews delete stored previews', async t => {
  const state = setup(t)
  await captureScheduledPreview(t)
  assert.equal(state.filesystem.files.size, 1)
  state.store.getters.getTabs = []
  await new Promise(setImmediate)
  assert.equal(state.filesystem.files.size, 0)

  state.store.getters.getTabs = [state.tab]
  await captureScheduledPreview(t)
  assert.equal(state.filesystem.files.size, 1)
  state.store.getters.getShowTabPreviews = false
  await new Promise(setImmediate)
  assert.equal(getCapacitorTabPreview(state.tab), null)
  assert.equal(state.filesystem.files.size, 0)
})

test('clearing the tab image cache removes stored previews', async t => {
  const state = setup(t)
  await captureScheduledPreview(t)
  await clearCapacitorTabImages()
  assert.equal(getCapacitorTabPreview(state.tab), null)
  assert.equal(state.filesystem.files.size, 0)
})
