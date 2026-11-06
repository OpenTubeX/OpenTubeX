import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { effectScope, nextTick, ref, watch } from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const start = source.includes('let modalLocked =') ? source.indexOf('let modalLocked =') : source.indexOf('watch(() => open.value && !organizerGesture.value')
const modal = source.slice(start, source.indexOf('watch(() => [props.enabled, presentedTabId.value'))
const teardown = source.slice(source.indexOf('onBeforeUnmount(() => {'), source.indexOf('</script>'))

for (const state of ['closed', 'dragging', 'settling', 'open', 'closed after commit']) {
  test(`organizer releases only its own modal lock on unmount: ${state}`, async () => {
    const open = ref(false)
    const organizerGesture = ref(false)
    const scope = effectScope()
    let locks = 1 // Another prompt already owns a lock.
    let unmount
    const prompts = new Set(['other'])
    const context = vm.createContext({
      pendingSwipeCloses: new Map(),
      open, organizerGesture, disposed: false, promptId: 'organizer',
      watch, showSyncedTabsView: ref(false),
      lockBodyScroll: () => { locks++ }, unlockBodyScroll: () => { locks-- },
      store: { commit: (action, id) => action === 'addOpenPrompt' ? prompts.add(id) : prompts.delete(id) },
      organizerSwipe: { cancel: () => { if (state === 'settling' || state === 'dragging') open.value = false } },
      resetTabSwipe() {}, resetTabDrag() {}, stopObservingContent() {},
      onBeforeUnmount: callback => { unmount = callback },
    })
    scope.run(() => vm.runInContext(`${modal}\n${teardown}`, context))
    if (state !== 'closed') {
      organizerGesture.value = true
      open.value = true
      await nextTick()
      assert.equal(locks, 1, 'a nonmodal pull cannot acquire a lock')
      if (state !== 'dragging') {
        organizerGesture.value = false
        await nextTick()
        assert.equal(locks, 2, 'committing acquires the organizer lock')
      }
      if (state === 'closed after commit') {
        open.value = false
        await nextTick()
        assert.equal(locks, 1)
      }
    }
    unmount()
    scope.stop() // Component watchers cannot clean up after unmount.
    await nextTick()
    assert.equal(locks, 1, 'teardown must release its lock exactly once and preserve other owners')
    assert.deepEqual([...prompts], ['other'])
  })
}
