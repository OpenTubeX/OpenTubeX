import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref, watch } from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const controller = source.slice(source.indexOf('let organizerTransition ='), source.indexOf('defineExpose({ organizerSwipe })'))
const openWatcher = source.slice(source.indexOf('watch(open, async'), source.indexOf('watch(() => open.value && !organizerGesture.value'))

for (const ending of ['short', 'reverse', 'pointercancel', 'resize', 'commit', 'select while settling']) {
  test(`organizer preserves the saved viewport after ${ending}`, async t => {
    const open = ref(false)
    const scroll = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 500 }) }
    const saved = { open: 123.5 }
    let finishAnimation
    const context = vm.createContext({
      props: { enabled: true }, open, openingSwitcher: false, disposed: false,
      document: { querySelector: () => ({}) },
      window: { innerHeight: 800, addEventListener() {}, removeEventListener() {} },
      organizerGesture: ref(false), skipDialogTransition: ref(false), activeView: ref('open'),
      captureBeforeTabOrganizer: async () => {}, nextTick, presentedTabId: ref('tab'), CSS: { escape: value => value },
      dialogRef: { value: {
        querySelector: () => ({ querySelector: () => ({}), getBoundingClientRect: () => ({ top: 800, bottom: 900 }) }),
        closest: () => ({}),
      } },
      openTabsScrollRef: ref(scroll), organizerSwipeProgress: distance => distance / 320,
      restoreOverlayScrollTop: (element, top) => { element.scrollTop = top },
      createOrganizerSwipeAnimation: () => ({ update() {}, dispose() {}, finish: () => ending === 'select while settling'
        ? new Promise(resolve => { finishAnimation = resolve }) : Promise.resolve() }),
      shouldOpenSwipedOrganizer: distance => distance >= 100,
      focusActiveTab() {}, activeScrollRef: () => scroll, viewScrollTop: saved,
      observeActiveContent() {}, stopObservingContent() {},
      watch: (...args) => { const stop = watch(...args); t.after(stop) },
    })
    const gesture = vm.runInContext(`${controller}; ${openWatcher}; organizerSwipe`, context)
    assert.equal(gesture.begin(), true)
    await new Promise(setImmediate)
    assert.equal(scroll.scrollTop, 523.5, 'the pull temporarily brings the active card into view')
    const committed = ending === 'commit' || ending === 'select while settling'
    if (ending === 'resize') gesture.cancel()
    else {
      if (ending === 'reverse') gesture.update(160)
      gesture.update(committed ? 160 : ending === 'reverse' ? 5 : 40)
      const finish = gesture.finish(1000, ending === 'pointercancel')
      if (ending === 'select while settling') {
        await new Promise(setImmediate)
        gesture.cancel()
        finishAnimation()
      }
      await finish
    }
    if (committed) open.value = false
    await nextTick()
    assert.equal(saved.open, committed ? 523.5 : 123.5, 'only committed pulls may persist the temporary viewport')
    scroll.scrollTop = 0
    open.value = true
    await new Promise(setImmediate)
    assert.equal(scroll.scrollTop, committed ? 523.5 : 123.5, 'normal opening restores the expected viewport')
  })
}
