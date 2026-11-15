import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from 'vue/compiler-sfc'

const { descriptor } = parse(await readFile(new URL('../../src/renderer/components/Settings/Sync/SyncPairingScanner.vue', import.meta.url), 'utf8'))
const source = compileScript(descriptor, { id: 'pairing-scanner-test' }).content
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace('export default', 'const Scanner =')

function setup({ capacitor = false } = {}) {
  let mount
  let unmount
  let detect
  let resolveStart
  let rejectStart
  let starts = 0
  let stops = 0
  let disabledBarcodeDetector
  const events = []
  const component = runInNewContext(source + '; Scanner', {
    process: { env: { IS_CAPACITOR: capacitor } },
    useTemplateRef: () => ({ value: {} }),
    onMounted: fn => { mount = fn },
    onBeforeUnmount: fn => { unmount = fn },
    useI18n: () => ({ t: key => key }),
    QrScanner: class {
      static _disableBarcodeDetector = false

      constructor(video, onDetect) {
        detect = onDetect
        disabledBarcodeDetector = this.constructor._disableBarcodeDetector
      }

      start() {
        starts++
        return new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject })
      }

      destroy() { stops++ }
    },
  })
  component.setup({ hint: 'Scan the code' }, {
    expose() {},
    emit: (...event) => events.push(event),
  })
  return {
    events,
    mount: () => mount(),
    unmount: () => unmount(),
    detect: data => detect({ data }),
    resolveStart: () => resolveStart(),
    rejectStart: error => rejectStart(error),
    counts: () => ({ starts, stops }),
    disabledBarcodeDetector: () => disabledBarcodeDetector,
  }
}

test('the scanner emits the first code once and stops on unmount', async () => {
  const f = setup()
  const mounted = f.mount()
  f.resolveStart()
  await mounted
  f.detect('first-code')
  f.detect('second-code')
  f.unmount()
  assert.deepEqual(f.counts(), { starts: 1, stops: 1 })
  assert.deepEqual(f.events, [['scan', 'first-code']])
})

test('a camera that cannot start reports the scanner as unavailable', async () => {
  const f = setup()
  const mounted = f.mount()
  f.rejectStart(new Error('Permission denied'))
  await mounted
  assert.deepEqual(f.counts(), { starts: 1, stops: 1 })
  assert.deepEqual(f.events, [['unavailable']])
})

test('a camera failure after unmounting reports nothing', async () => {
  const f = setup()
  const mounted = f.mount()
  f.unmount()
  f.rejectStart(new Error('Camera failed'))
  await mounted
  assert.deepEqual(f.events, [])
})

test('the mobile apps decode with the worker instead of the WebView BarcodeDetector', async () => {
  for (const capacitor of [false, true]) {
    const f = setup({ capacitor })
    const mounted = f.mount()
    f.resolveStart()
    await mounted
    assert.equal(f.disabledBarcodeDetector(), capacitor)
  }
})
