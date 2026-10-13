import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/TabContent/TabContent.vue', import.meta.url), 'utf8')
const start = source.indexOf('let lifecycleRevision = 0')
const end = source.indexOf('\nwatch(isWatchRoute,', start)
assert.ok(start !== -1 && end !== -1, 'Keep the harness aligned with the tab lifecycle block')
const lifecycle = source.slice(start, end)

for (const metadata of [{ title: 'New title' }, { isLoading: false }]) {
  test(`metadata ${Object.keys(metadata)[0]} updates cannot strand an unloading tab`, async t => {
    const props = reactive({ tab: { id: 'watch', loadState: 'loaded', mountRevision: 1, refreshKey: 0 } })
    const initialized = ref(true)
    const scope = effectScope()
    t.after(() => scope.stop())
    let finishDisposal
    let disposals = 0
    const disposal = new Promise(resolve => { finishDisposal = resolve })
    scope.run(() => vm.runInNewContext(lifecycle, {
      props, initialized, watch, nextTick,
      shouldMount: computed(() => props.tab.loadState !== 'unloaded'),
      previousRefreshKey: 0,
      acknowledgedMountRevision: 1,
      navigation: { setLoadingSource() {} },
      TAB_LOADER_LOADING_SOURCE: 'loader',
      tabLifecycleService: { run() { disposals++; return disposal } },
      tabContentRef: ref(null), document: { pictureInPictureElement: null },
      store: { commit() {}, getters: { getActiveTabId: null } },
      process: { env: {} }, window: {},
      updateLoaderState() {}, scheduleLoaderUpdate() {},
    }))
    await setImmediate()
    props.tab = { ...props.tab, loadState: 'unloaded', refreshKey: 1 }
    await nextTick()
    assert.equal(disposals, 1)
    props.tab = { ...props.tab, ...metadata }
    await nextTick()
    finishDisposal()
    await setImmediate()
    assert.equal(disposals, 1, 'notify the disposed instance once')
    assert.equal(initialized.value, false, 'remove the player after disposal completes')
  })
}
