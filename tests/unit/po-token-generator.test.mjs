import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { isAttestedPoToken, mintAttestedPoToken } from '../../src/main/attestedPoToken.js'
import { withTimeout } from '../../src/main/promiseTimeout.js'

const source = (await readFile(new URL('../../src/main/poTokenGenerator.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace('export function ', 'function ')

test('PO token generation preserves replacement sequences in YouTube JSON arguments', async () => {
  let received
  let closed = false
  const generate = vm.runInNewContext(`${source}
    theSession = { async closeAllConnections() {}, async clearData() {} };
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
 * @param {{ attest: () => string, mint?: () => string, validForSecs?: number }} botGuard
 */
function load({ attest, mint = () => attested, validForSecs = 600 }) {
  const views = []
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
    async setProxy() {},
    webRequest: { onBeforeSendHeaders() {}, onHeadersReceived() {}, onBeforeRequest() {} },
    async closeAllConnections() {},
    async clearData() { cleanups++ },
  }
  const { generatePoToken } = vm.runInNewContext(`${source}\n({ generatePoToken })`, {
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
  const generate = () => generatePoToken('videoId', '{}', '{}', '{}', undefined)
  return { generate, views, cleanups: () => cleanups }
}

test('later tokens reuse the attestation', async () => {
  const { generate, views, cleanups } = load({ attest: () => attested, mint: () => 'm'.repeat(120) })
  assert.equal(await generate(), attested)
  assert.equal(await generate(), 'm'.repeat(120))
  assert.equal(views.length, 1)
  assert.equal(views[0].closed, false)
  assert.equal(cleanups(), 0)
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

test('an attestation without a lifetime is not kept', async () => {
  const { generate, views, cleanups } = load({ attest: () => attested, validForSecs: null })
  await generate()
  await generate()
  assert.equal(views.length, 2)
  assert.equal(views[0].closed, true)
  assert.equal(cleanups(), 2)
})
