import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from 'vue/compiler-sfc'
import webpack from 'webpack'

const { descriptor } = parse(await readFile(new URL('../../src/renderer/components/Settings/Sync/SyncPairingScanner.vue', import.meta.url), 'utf8'))
const compiledSource = compileScript(descriptor, { id: 'pairing-scanner-test' }).content
const source = compiledSource
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace('export default', 'const Scanner =')
  .replace("import('../../../helpers/nativePairingScanner')", 'loadNativeScanner()')

function setup({ native = true } = {}) {
  let resolveScan
  let rejectScan
  let mount
  let unmount
  let nativeLoads = 0
  let browserStarts = 0
  let browserStops = 0
  let detect
  const events = []
  const scan = new Promise((resolve, reject) => { resolveScan = resolve; rejectScan = reject })
  const ref = value => ({ value })
  const component = runInNewContext(source + '; Scanner', {
    process: { env: { IS_CAPACITOR: native } },
    FtLoader: {},
    useTemplateRef: () => ref({}),
    onMounted: fn => { mount = fn },
    onBeforeUnmount: fn => { unmount = fn },
    useI18n: () => ({ t: key => key }),
    loadNativeScanner: async () => {
      nativeLoads++
      return { scanNativePairingCode: () => scan }
    },
    QrScanner: class {
      constructor(video, onDetect) { detect = onDetect }
      async start() { browserStarts++ }
      destroy() { browserStops++ }
    },
  })
  component.setup({ hint: 'Scan the code' }, {
    expose() {},
    emit: (...event) => events.push(event),
  })
  return {
    events, resolveScan, rejectScan,
    mount: () => mount(),
    unmount: () => unmount(),
    detect: data => detect({ data }),
    counts: () => ({ nativeLoads, browserStarts, browserStops }),
  }
}

async function flush() {
  // Settle the lazy import and scan promise continuations.
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

test('Capacitor uses native scanning and emits its result', async () => {
  const f = setup()
  f.mount()
  f.resolveScan('opentubex-pairing:code')
  await flush()
  assert.deepEqual(f.counts(), { nativeLoads: 1, browserStarts: 0, browserStops: 0 })
  assert.deepEqual(f.events, [['scan', 'opentubex-pairing:code']])
})

test('native cancellation and denied camera access are reported separately', async () => {
  for (const denied of [false, true]) {
    const f = setup()
    f.mount()
    if (denied) f.rejectScan(new Error('Permission denied'))
    else f.resolveScan(null)
    await flush()
    assert.deepEqual(f.events, [[denied ? 'unavailable' : 'cancel']])
  }
})

test('unmounting invalidates a pending native scan', async () => {
  for (const rejected of [false, true]) {
    const f = setup()
    f.mount()
    await flush()
    f.unmount()
    if (rejected) f.rejectScan(new Error('Camera failed'))
    else f.resolveScan('stale-code')
    await flush()
    assert.deepEqual(f.events, [])
  }
})

test('desktop and web use the embedded scanner, emit once, and stop it on unmount', async () => {
  const f = setup({ native: false })
  f.mount()
  await flush()
  f.detect('first-code')
  f.detect('second-code')
  f.unmount()
  assert.deepEqual(f.counts(), { nativeLoads: 0, browserStarts: 1, browserStops: 1 })
  assert.deepEqual(f.events, [['scan', 'first-code']])
})

test('desktop bundles exclude the native scanner while Capacitor bundles include it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-bundle-'))
  const helper = fileURLToPath(new URL('../../src/renderer/helpers/nativePairingScanner.js', import.meta.url))
  try {
    const entry = join(directory, 'pairing.js')
    await writeFile(entry, compiledSource.replace("'../../../helpers/nativePairingScanner'", JSON.stringify(helper)))
    for (const native of [false, true]) {
      const stats = await new Promise((resolve, reject) => {
        webpack({
          mode: 'production',
          entry,
          output: { path: join(directory, String(native)) },
          // Only inspect pairing's native import; other component dependencies are unrelated.
          externals: [({ request }, callback) => {
            if (request === entry || request === helper) callback()
            else callback(null, `commonjs ${request}`)
          }],
          plugins: [new webpack.DefinePlugin({ 'process.env.IS_CAPACITOR': JSON.stringify(native) })],
        }, (error, result) => error ? reject(error) : resolve(result))
      })
      assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }))
      const modules = stats.toJson({ all: false, modules: true }).modules
      assert.equal(modules.some(module => module.name?.includes('nativePairingScanner')), native,
        native ? 'Capacitor must include its native scanner' : 'Desktop must not emit the native scanner chunk')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
