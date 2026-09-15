import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/main/poTokenGenerator.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace('export function ', 'function ')

test('PO token generation preserves replacement sequences in YouTube JSON arguments', async () => {
  let received
  let closed = false
  const generate = vm.runInNewContext(`${source}
    theSession = {};
    cachedScript = 'capture(FT_PARAMS)';
    internalGeneratePotoken
  `, {
    WebContentsView: class {
      webContents = {
        setWindowOpenHandler() {},
        setAudioMuted() {},
        debugger: { attach() {}, async sendCommand() {} },
        async loadURL() {},
        async executeJavaScript(script) {
          return vm.runInNewContext(script, { capture: (...args) => { received = args; return 'token' } })
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
