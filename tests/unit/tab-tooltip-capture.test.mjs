import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/TabBar/useTabTooltip.js', import.meta.url), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))

function createTooltipProvider() {
  let api
  let capturing = true
  const timers = new Map()
  const frames = []
  vm.runInNewContext(`${source.replace(/^import .*$/gm, '').replaceAll('export ', '')}\nprovideTabTooltip()`, {
    shallowRef: value => ({ value }),
    provide: (_, value) => { api = value },
    onBeforeUnmount() {},
    setTimeout: callback => { timers.set(callback, callback); return callback },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => frames.push(callback),
    document: { documentElement: { classList: { contains: name => {
      assert.equal(name, 'opentubex-tab-preview-capturing')
      return capturing
    } } } },
    // Inactive tabs return their cache immediately, independently of a capture
    // already running for the presented tab in the main process.
    window: { ftElectron: { tabs: { capturePreview: async () => 'cached-preview' } } }
  })
  return {
    api,
    async show(tooltip) {
      api.show(tooltip)
      for (const callback of timers.values()) callback()
      timers.clear()
      await flush()
    },
    async finishCapture() {
      capturing = false
      for (const callback of frames.splice(0)) callback()
      await flush()
    }
  }
}

for (const showPreview of [true, false]) {
  test(`waits for a background capture before mounting a tooltip with previews ${showPreview}`, async () => {
    const provider = createTooltipProvider()
    const tooltip = { id: 'inactive', props: { showPreview, tabs: [{ id: 'inactive' }] } }
    await provider.show(tooltip)
    assert.equal(provider.api.active.value, null, 'capture mode must finish before the entry fade starts')
    await provider.finishCapture()
    assert.equal(provider.api.active.value, tooltip)
  })
}

test('does not reopen a tooltip dismissed while waiting for a background capture', async () => {
  const provider = createTooltipProvider()
  await provider.show({ id: 'inactive', props: { showPreview: true, tabs: [{ id: 'inactive' }] } })
  provider.api.dismiss()
  await provider.finishCapture()
  assert.equal(provider.api.active.value, null)
})
