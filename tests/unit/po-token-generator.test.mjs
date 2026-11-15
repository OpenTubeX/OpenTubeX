import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { rspack } from '@rspack/core'
import botGuardConfig from '../../_scripts/rspack.botGuardScript.config.js'
import { isAttestedPoToken, mintAttestedPoToken } from '../../src/main/attestedPoToken.js'
import { withTimeout } from '../../src/main/promiseTimeout.js'

const source = (await readFile(new URL('../../src/main/poTokenGenerator.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replaceAll('export function ', 'function ')

test('PO token generation preserves replacement sequences in YouTube JSON arguments', async () => {
  let received
  let closed = false
  const generate = vm.runInNewContext(`${source}
    theSession = { async setProxy() {}, async closeAllConnections() {}, async clearData() {} };
    cachedScript = 'capture(FT_PARAMS)';
    attest
  `, {
    WebContentsView: class {
      webContents = {
        setWindowOpenHandler() {},
        setAudioMuted() {},
        debugger: { attach() {}, async sendCommand() {} },
        async loadURL() {},
        async executeJavaScript(script) {
          return vm.runInNewContext(script, { capture: (...args) => { received = args; return 'token' }, window: {} })
        },
        close() { closed = true },
      }

      setBounds() {}
    },
    withTimeout: promise => promise,
  })
  const data = { text: "$& $$ $` $'", nested: ['quotes " and \\'] }
  const json = JSON.stringify(data)
  assert.equal(await generate('abcdefghijk', json, json, json), 'token')
  assert.deepEqual(JSON.parse(JSON.stringify(received)), ['abcdefghijk', data, data, data])
  assert.equal(closed, true)
})

const attested = 'a'.repeat(120)
const pending = 'p'.repeat(124)

/**
 * @param {{ attest: () => string, mint?: () => string, validForSecs?: number | null, clearData?: () => Promise<void> }} botGuard
 */
function load({ attest, mint = () => attested, validForSecs = 600, clearData = async () => {} }) {
  const views = []
  const proxies = []
  let cleanups = 0
  class WebContentsView {
    constructor() {
      views.push(this)
      this.closed = false
      this.webContents = {
        setWindowOpenHandler() {},
        setAudioMuted() {},
        debugger: { attach() {}, async sendCommand() {} },
        async loadURL() {},
        isDestroyed: () => this.closed,
        // Electron segfaults here for offscreen views outside a window
        isFocused: () => { throw new Error('isFocused() crashes the main process') },
        close: () => { this.closed = true },
        executeJavaScript: async (script) => {
          if (script.startsWith('window.ftMintPoToken')) return mint()
          if (script === 'window.ftPoTokenValidForSecs') return validForSecs
          return attest()
        },
      }
    }

    setBounds() {}
  }
  const theSession = {
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    setUserAgent() {},
    async setProxy(config) { proxies.push(config) },
    webRequest: { onBeforeSendHeaders() {}, onHeadersReceived() {}, onBeforeRequest() {} },
    async closeAllConnections() {},
    async clearData() {
      cleanups++
      await clearData()
    },
  }
  const { generatePoToken, mintPoTokenFromAttestation } = vm.runInNewContext(`${source}\n({ generatePoToken, mintPoTokenFromAttestation })`, {
    session: { fromPartition: () => theSession, defaultSession: { getUserAgent: () => 'agent' } },
    WebContentsView,
    readFile: async () => 'function bg(){}export{bg as default};',
    join: (...parts) => parts.join('/'),
    isAttestedPoToken,
    mintAttestedPoToken,
    withTimeout,
    process: { env: {} },
    __dirname: '',
    // Expiry timers must not keep the test process alive
    setTimeout: (callback, delay) => {
      const timer = setTimeout(callback, delay)
      timer.unref?.()
      return timer
    },
    clearTimeout,
    Date,
    console,
  })
  const generate = proxyUrl => generatePoToken('videoId', '{}', '{}', '{}', proxyUrl)
  const mintOnly = proxyUrl => mintPoTokenFromAttestation('videoId', proxyUrl)
  return { generate, mintOnly, views, proxies, cleanups: () => cleanups }
}

test('later tokens reuse the attestation', async () => {
  const { generate, views, cleanups } = load({ attest: () => attested, mint: () => 'm'.repeat(120) })
  assert.equal(await generate(), attested)
  assert.equal(await generate(), 'm'.repeat(120))
  assert.equal(views.length, 1)
  assert.equal(views[0].closed, false)
  assert.equal(cleanups(), 0)
})

test('minting without BotGuard needs an attestation', async () => {
  let mints = 0
  const { generate, mintOnly, views } = load({ attest: () => attested, mint: () => ++mints === 1 ? 'm'.repeat(120) : pending })
  assert.equal(await mintOnly(), null)
  assert.equal(views.length, 0, 'A mint-only request must not run BotGuard')
  await generate()
  assert.equal(await mintOnly(), 'm'.repeat(120))
  assert.equal(await mintOnly('socks5://127.0.0.1:9050'), null, 'An attestation of another route does not count')
  await generate()
  // A token pending attestation discards it, so the next load attests from the watch page
  assert.equal(await mintOnly(), null)
  assert.equal(views.at(-1).closed, true)
  assert.equal(await mintOnly(), null)
  assert.equal(views.length, 2)
})

test('minting does not wait for a BotGuard run in progress', async () => {
  let finishAttestation
  const { generate, mintOnly } = load({ attest: () => new Promise(resolve => { finishAttestation = resolve }) })
  const attesting = generate()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(await mintOnly(), null)
  finishAttestation(attested)
  assert.equal(await attesting, attested)
})

test('an attestation that mints a token pending attestation is replaced', async () => {
  const attestations = [pending, attested]
  const { generate, views, cleanups } = load({ attest: () => attestations.shift() })
  assert.equal(await generate(), attested)
  assert.equal(views.length, 2)
  assert.equal(views[0].closed, true)
  assert.equal(cleanups(), 1)
  assert.equal(await generate(), attested)
  assert.equal(views.length, 2)
})

test('a failed mint attests again', async () => {
  let mints = 0
  const { generate, views } = load({
    attest: () => attested,
    mint: () => {
      if (++mints === 1) throw new Error('destroyed')
      return attested
    },
  })
  await generate()
  assert.equal(await generate(), attested)
  assert.equal(views.length, 2)
  assert.equal(views[0].closed, true)
})

test('an expired attestation attests again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 })
  const { generate, views } = load({ attest: () => attested, validForSecs: 60 })
  await generate()
  t.mock.timers.tick(60_000)
  await generate()
  assert.equal(views.length, 2)
  assert.equal(views[0].closed, true)
})

test('an expired attestation is released without another token', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const { generate, views, cleanups } = load({ attest: () => attested, validForSecs: 60 })
  await generate()
  t.mock.timers.tick(60_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(views[0].closed, true)
  assert.equal(cleanups(), 1)
})

test('the attestation lifetime counts from before the BotGuard run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const { generate, views } = load({
    attest: () => {
      t.mock.timers.tick(10_000)
      return attested
    },
    validForSecs: 60,
  })
  await generate()
  t.mock.timers.tick(50_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(views[0].closed, true)
})

test('a token requested as the attestation expires keeps its replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const { generate, views } = load({ attest: () => attested, validForSecs: 60 })
  await generate()
  t.mock.timers.tick(59_999)
  const token = generate()
  t.mock.timers.tick(1)
  await token
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(views.length, 2)
  assert.equal(views[1].closed, false)
})

test('a failed session cleanup does not fail the token', async () => {
  const attestations = [pending, attested]
  const { generate } = load({
    attest: () => attestations.shift(),
    clearData: async () => { throw new Error('cleanup failed') },
  })
  assert.equal(await generate(), attested)
})

test('an attestation without a lifetime is not kept', async () => {
  const { generate, views, cleanups } = load({ attest: () => attested, validForSecs: null })
  await generate()
  await generate()
  assert.equal(views.length, 2)
  assert.equal(views[0].closed, true)
  assert.equal(cleanups(), 2)
})

test('the BotGuard view never asks Electron whether it is focused', async () => {
  // Menu accelerators call isFocused() on every web contents while the view exists
  const { generate, views } = load({ attest: () => attested })
  await generate()
  assert.equal(views[0].closed, false)
  assert.equal(views[0].webContents.isFocused(), false)
})

test('disabling the proxy restores the default route for the next attestation', async () => {
  const { generate, views, proxies } = load({ attest: () => attested })
  await generate('socks5://127.0.0.1:9050')
  await generate(undefined)
  assert.equal(views.length, 2, 'a proxy change replaces the attestation')
  assert.deepEqual(JSON.parse(JSON.stringify(proxies)), [{ proxyRules: 'socks5://127.0.0.1:9050' }, { mode: 'system' }])
})

test('the bundled BotGuard script calls its default export with the parameters', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-botguard-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const compiler = rspack({ ...botGuardConfig, output: { ...botGuardConfig.output, path: directory } })
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => compiler.close(() => (error ? reject(error) : resolve(result))))
  })
  assert.ok(!stats.hasErrors(), stats.toString('errors-only'))

  const toBotGuardCall = vm.runInNewContext(`${source}\ntoBotGuardCall`)
  const script = toBotGuardCall(await readFile(join(directory, 'botGuardScript.js'), 'utf8'))
  assert.match(script, /\(FT_PARAMS\)$/)
  // Without the parameters, the script evaluates to the function it would call
  const generate = vm.runInNewContext(script.replace(/\(FT_PARAMS\)$/, ''))
  assert.equal(typeof generate, 'function')
  assert.equal(generate.length, 4, 'videoId, context, initialAttestationData and ytConfig')
})
