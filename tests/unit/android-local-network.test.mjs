import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { classifyRequestFailure } from '../../src/renderer/helpers/api/requestDiagnostics.js'

const source = await readFile(new URL('../../src/renderer/helpers/androidLocalNetwork.js', import.meta.url), 'utf8')

function fixture (native, env = { IS_CAPACITOR: true }, message = 'Nearby devices permission was denied') {
  const context = vm.createContext({ process: { env }, registerPlugin: () => native, i18n: { global: { t: () => message } } })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace('export async function', 'async function')
    .replace("await import('../i18n/index.js')", '({ default: globalThis.i18n })'), context)
  return context.ensureAndroidLocalNetworkAccess
}

test('LAN requests share a permission prompt and resume only after a grant', async () => {
  let finish
  let prompts = 0
  const permission = new Promise(resolve => { finish = resolve })
  const access = fixture({
    checkAccess: async () => ({ required: true }),
    requestPermissions: () => { prompts++; return permission },
  })
  let completed = false
  const requests = Promise.all([access(), access({ url: 'http://192.168.1.2' }), access({ requestPermission: false })])
    .then(() => { completed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(prompts, 1)
  assert.equal(completed, false)
  finish({ localNetwork: 'granted' })
  await requests
  assert.equal(completed, true)
})

test('denying LAN permission rejects the request and a later request can recover', async () => {
  let permission = 'denied'
  const access = fixture({
    checkAccess: async () => ({ required: true }),
    requestPermissions: async () => ({ localNetwork: permission }),
  })
  await assert.rejects(access(), error => {
    assert.match(error.message, /Nearby devices permission was denied/)
    assert.equal(classifyRequestFailure(error), 'api', 'Permission denial must not enter network recovery or prompt again automatically')
    return true
  })
  permission = 'granted'
  await access()
})

test('localized permission denials never enter network recovery', async () => {
  const access = fixture({
    checkAccess: async () => ({ required: true }),
    requestPermissions: async () => ({ localNetwork: 'denied' }),
  }, { IS_CAPACITOR: true }, 'Local network permission was denied')
  await assert.rejects(access(), error => {
    assert.equal(error.code, 'LOCAL_ACCESS_DENIED')
    assert.equal(error.message, 'Local network permission was denied')
    assert.equal(classifyRequestFailure(error), 'api')
    return true
  })
})

test('public networking skips the permission prompt', async () => {
  const received = []
  const access = fixture({
    // Android 17 without the permission: only a check with a host can answer "not required"
    checkAccess: async options => { received.push(options); return { required: options.url === undefined } },
    requestPermissions: () => { assert.fail('No permission prompt is needed') },
  })
  await access({ url: 'https://www.youtube.com' })
  await access({ url: 'https://www.youtube.com/feed' })
  assert.deepEqual(received.map(options => options.url), [undefined, 'https://www.youtube.com', 'https://www.youtube.com/feed'])
})

test('older Android versions ask the bridge once for all requests', async () => {
  let checks = 0
  const access = fixture({
    checkAccess: async () => { checks++; return { required: false } },
    requestPermissions: () => { assert.fail('No permission prompt is needed') },
  })
  await Promise.all([access({ url: 'https://www.youtube.com' }), access({ url: 'http://192.168.1.2' })])
  await access()
  assert.equal(checks, 1)
})

test('a granted permission ends the bridge checks', async () => {
  let checks = 0
  const access = fixture({
    checkAccess: async () => { checks++; return { required: true } },
    requestPermissions: async () => ({ localNetwork: 'granted' }),
  })
  await access({ url: 'http://192.168.1.2' })
  assert.equal(checks, 2)
  await access({ url: 'http://192.168.1.3' })
  assert.equal(checks, 2)
})

test('background permission checks do not open another system prompt after denial', async () => {
  const access = fixture({
    checkAccess: async () => ({ required: true }),
    requestPermissions: () => assert.fail('Background retries must not request consent again'),
  })
  await assert.rejects(access({ requestPermission: false }), { code: 'LOCAL_ACCESS_DENIED' })
})

test('desktop and iOS do not call the Android permission bridge', async () => {
  await fixture(null, {})()
  await fixture(null, { IS_CAPACITOR: true, IS_IOS: true })()
})

test('saving an enabled LAN proxy does not depend on access permission', async () => {
  const calls = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } },
    registerPlugin: () => ({ configure: async options => { calls.push(['configure', options.enabled]) } }),
  })
  const proxySource = await readFile(new URL('../../src/renderer/helpers/androidProxy.js', import.meta.url), 'utf8')
  vm.runInContext(proxySource.replace(/^import .*\n/gm, '').replace(/^export /gm, ''), context)
  await context.configureAndroidProxy({ useProxy: true, proxyHostname: '192.168.1.2' })
  assert.deepEqual(calls, [['configure', true]])
})
