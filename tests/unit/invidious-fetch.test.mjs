import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { createAbortError } from '../../src/renderer/helpers/api/requestErrors.js'
import { waitForRequest } from '../../src/renderer/helpers/api/requestWait.js'

const source = readFileSync(new URL('../../src/renderer/helpers/api/invidious.js', import.meta.url), 'utf8')
const fetchSource = source.match(/export (?:async )?function invidiousFetch\([\s\S]*?(?=\nfunction invidiousAPICall\()/)[0]
  .replace(/^export /, '')

function fixture ({ env = {}, authorization = null, getters = { getApiServerAuthorization: authorization }, permission = async () => {}, request = async () => 'response', yattee = false, nativeRequest } = {}) {
  return vm.runInNewContext(`${fetchSource.replace("await import('./capacitor-http')", 'capacitorHttp')}; invidiousFetch`, {
    process: { env },
    createAbortError,
    waitForRequest,
    store: { getters },
    isYatteeBackend: () => yattee,
    capacitorHttp: { capacitorHttpFetch: nativeRequest },
    ensureAndroidLocalNetworkAccess: permission,
    fetch: request,
  })
}

test('mobile Yattee requests use native HTTP because the server rejects CORS preflights', async () => {
  for (const env of [{ IS_CAPACITOR: true }, { IS_CAPACITOR: true, IS_IOS: true }]) {
    const calls = []
    const signal = new AbortController().signal
    const fetch = fixture({
      env,
      yattee: true,
      authorization: 'Basic secret',
      permission: async () => { throw new Error('the native client checks LAN access per redirect') },
      request: async () => { throw new Error('the WebView must not be used') },
      nativeRequest: async (url, init) => { calls.push({ url, init }); return 'native response' }
    })
    assert.equal(await fetch('http://192.168.1.2:8085/api/v1/videos/id', signal), 'native response')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'http://192.168.1.2:8085/api/v1/videos/id')
    assert.equal(calls[0].init.signal, signal)
    assert.equal(calls[0].init.allowHttp, true)
    assert.equal(calls[0].init.headers.Authorization, 'Basic secret')
  }
})

test('authenticated Invidious API requests bypass the browser cache and preserve cancellation', async () => {
  for (const authorization of ['test-account', null]) {
    let requestedOptions
    const signal = new AbortController().signal
    const fetch = fixture({ authorization, request: async (_url, options) => { requestedOptions = options; return 'response' } })
    assert.equal(await fetch('https://instance.example/api/v1/account', signal), 'response')
    assert.equal(requestedOptions.signal, signal)
    assert.equal(requestedOptions.headers?.Authorization ?? null, authorization)
    assert.equal(requestedOptions.cache, authorization ? 'no-store' : undefined)
  }
})

test('Android Invidious waits for LAN consent before its WebView request', async () => {
  let allow
  let fetched = false
  const permission = new Promise(resolve => { allow = resolve })
  const fetch = fixture({
    env: { IS_CAPACITOR: true },
    permission: async ({ url }) => { assert.equal(url, 'http://192.168.1.2/api/v1/stats'); await permission },
    request: async () => { fetched = true; return 'response' },
  })
  const pending = fetch('http://192.168.1.2/api/v1/stats')
  await new Promise(resolve => setImmediate(resolve))
  try { assert.equal(fetched, false) } finally { allow() }
  assert.equal(await pending, 'response')
})

test('Android Invidious never fetches a LAN instance after permission denial', async () => {
  let fetched = false
  const fetch = fixture({
    env: { IS_CAPACITOR: true },
    permission: async () => { throw Object.assign(new Error('Permission denied'), { code: 'LOCAL_ACCESS_DENIED' }) },
    request: async () => { fetched = true },
  })
  await assert.rejects(fetch('http://192.168.1.2/api/v1/stats'), { code: 'LOCAL_ACCESS_DENIED' })
  assert.equal(fetched, false)
})

test('pending consent keeps the request URL and its original credentials together', async () => {
  let allow
  const permission = new Promise(resolve => { allow = resolve })
  const getters = { getApiServerAuthorization: 'first-account' }
  const url = new URL('https://first.example/api/v1/stats')
  const fetch = fixture({
    env: { IS_CAPACITOR: true },
    getters,
    permission: () => permission,
    request: async (requestUrl, options) => {
      assert.equal(requestUrl, 'https://first.example/api/v1/stats')
      assert.equal(options.headers.Authorization, 'first-account')
    }
  })
  const pending = fetch(url)
  getters.getApiServerAuthorization = 'second-account'
  url.hostname = 'second.example'
  allow()
  await pending
})

test('cancelling Invidious preflight rejects before shared consent settles', { timeout: 5000 }, async () => {
  let allow
  let fetched = false
  const permission = new Promise(resolve => { allow = resolve })
  const controller = new AbortController()
  const fetch = fixture({
    env: { IS_CAPACITOR: true },
    permission: () => permission,
    request: async () => { fetched = true },
  })
  const pending = fetch('http://192.168.1.2/api/v1/stats', controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  try { await assert.rejects(pending, { name: 'AbortError' }) } finally { allow() }
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fetched, false)
})

test('already-aborted Invidious requests do not start a permission check', async () => {
  const controller = new AbortController()
  controller.abort()
  const fetch = fixture({
    env: { IS_CAPACITOR: true },
    permission: () => assert.fail('Cancelled preflight must not start'),
    request: () => assert.fail('Cancelled request must not start'),
  })
  await assert.rejects(fetch('http://192.168.1.2', controller.signal), { name: 'AbortError' })
})

test('desktop and iOS Invidious requests do not call Android permission APIs', async () => {
  for (const env of [{}, { IS_CAPACITOR: true, IS_IOS: true }]) {
    const fetch = fixture({ env, permission: () => assert.fail('Android bridge must not be called') })
    assert.equal(await fetch('https://instance.example'), 'response')
  }
})
