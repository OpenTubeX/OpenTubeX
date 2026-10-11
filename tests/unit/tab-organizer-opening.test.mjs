import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { createCapacitorPreviewCache, canCaptureCapacitorTab } from '../../src/renderer/tabs/capacitorPreviewCache.js'

const previews = readFileSync(new URL('../../src/renderer/tabs/capacitorTabPreviews.js', import.meta.url), 'utf8')
const switcher = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const opening = switcher.slice(switcher.indexOf('let disposed'), switcher.indexOf('defineExpose({ organizerSwipe })'))
const flush = () => new Promise(resolve => setImmediate(resolve))

function createOrganizer () {
  const timers = new Map()
  const tab = { id: 'active', route: { fullPath: '/home' }, loadState: 'loaded' }
  const open = { value: false }
  let captures = 0
  let finishCapture
  const frame = new Promise(resolve => { finishCapture = resolve })
  const context = vm.createContext({
    createCapacitorPreviewCache,
    canCaptureCapacitorTab,
    Capacitor: { isPluginAvailable: () => true },
    registerPlugin: () => ({ take: () => { captures++; return frame } }),
    shallowReactive: value => value,
    watch: (_, callback, options) => { if (options.immediate) callback(); return () => {} },
    setTimeout: (callback, ms) => { timers.set(callback, ms); return callback },
    clearTimeout: callback => timers.delete(callback),
    process: { env: { IS_CAPACITOR: true } },
    document: { visibilityState: 'visible', querySelectorAll: () => [], querySelector: () => ({}), addEventListener () {}, removeEventListener () {} },
    window: { innerHeight: 800, addEventListener () {}, removeEventListener () {} },
    getCapacitorTabPreviewRegion: () => ({ width: 400, top: 60, height: 740 }),
    open,
    props: { enabled: true },
    activeView: {},
    skipDialogTransition: {},
    organizerGesture: {},
    nextTick: async () => {},
    dialogRef: { value: { querySelector: () => ({ querySelector: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 100 }) }), closest: () => ({}) } },
    openTabsScrollRef: { value: null },
    presentedTabId: { value: tab.id },
    CSS: { escape: value => value },
    createOrganizerSwipeAnimation: () => ({ update () {}, dispose () {} }),
    organizerSwipeProgress: () => 0,
    console,
  })
  const api = vm.runInContext(`${previews.replace(/^import .*$/gm, '').replaceAll('export ', '')}
    initializeCapacitorTabPreviews({ getters: {
      getShowTabPreviews: true, getPresentedTab: ${JSON.stringify(tab)},
      getActiveTabId: 'active', getTabs: [${JSON.stringify(tab)}]
    } }, { value: null });
    ${opening}
    ;({ openSwitcher, organizerSwipe, getPreview: () => getCapacitorTabPreview(${JSON.stringify(tab)}) })`, context)
  return {
    ...api,
    open,
    timers,
    get captures () { return captures },
    finishCapture: () => finishCapture({ dataUrl: 'cached-page' }),
    async runBackgroundCapture () {
      for (const [callback, ms] of [...timers]) {
        if (ms === 600) { timers.delete(callback); callback() }
      }
      await flush()
    },
  }
}

for (const method of ['button', 'swipe']) {
  for (const previewState of ['missing', 'cached', 'capturing']) {
    test(`${method} opens immediately with a ${previewState} preview`, async () => {
      const organizer = createOrganizer()
      if (previewState !== 'missing') await organizer.runBackgroundCapture()
      if (previewState === 'cached') {
        organizer.finishCapture()
        await flush()
        assert.equal(organizer.getPreview(), 'cached-page')
      }
      const captures = organizer.captures
      if (method === 'button') organizer.openSwitcher()
      else assert.equal(organizer.organizerSwipe.begin(), true)
      await flush()
      assert.equal(organizer.open.value, true, 'Opening must not wait for native screenshot completion or its timeout')
      assert.equal(organizer.captures, captures, 'Opening must reuse the last-seen preview without starting a screenshot')
      assert.equal(organizer.timers.size, 0, 'Opening must cancel scheduled background capture')
      organizer.finishCapture()
      await flush()
      assert.equal(organizer.getPreview(), previewState === 'cached' ? 'cached-page' : null,
        'A capture completing after the organizer opens must not replace the last-seen preview')
    })
  }
}
