import assert from 'node:assert/strict'
import test from 'node:test'
import { createIOSMediaTransport } from '../../src/renderer/helpers/player/iosMediaTransport.js'

function fixture(overrides = {}) {
  const prepared = [], aborted = [], fetched = []
  let fetchAborts = 0
  class Operation {
    constructor(promise, abort) { this.promise = promise; this.abort = abort }
  }
  const shaka = {
    util: { AbortableOperation: Operation, Error: Object.assign(class extends Error {}, {
      Severity: { RECOVERABLE: 1 }, Category: { NETWORK: 1 }, Code: { OPERATION_ABORTED: 7001 }
    }) },
    net: { HttpFetchPlugin: { parse: (url, request) => {
      fetched.push({ url, request })
      return new Operation(Promise.resolve({ uri: url, headers: { 'x-opentubex-media-url': 'https://rr2.googlevideo.com/final/index.m3u8' }, data: new Uint8Array([1, 2]).buffer }), async () => { fetchAborts++ })
    } } }
  }
  const native = {
    prepare: async options => { prepared.push(options); return { requestId: `request-${prepared.length}` } },
    abort: async ({ requestId }) => { aborted.push(requestId) },
    ...overrides
  }
  return { request: createIOSMediaTransport(shaka, native), prepared, aborted, fetched, get fetchAborts() { return fetchAborts } }
}
const manifest = 'https://manifest.googlevideo.com/api/manifest/hls_variant/file/index.m3u8'
const get = { method: 'GET', headers: { Range: 'bytes=0-99' } }

test('iOS HLS uses streamed native GET with headers and restores the final manifest URL', async () => {
  const f = fixture()
  const response = await f.request(manifest, get, 0).promise
  assert.equal(f.prepared[0].method, 'GET')
  assert.equal(f.prepared[0].url, manifest)
  assert.equal(f.prepared[0].headers.Range, 'bytes=0-99')
  assert.equal(f.fetched[0].url, '/_opentubex_sabr/request-1')
  assert.equal(response.uri, 'https://rr2.googlevideo.com/final/index.m3u8')
  assert.equal(response.originalUri, manifest)
  assert.equal(response.headers['x-opentubex-media-url'], undefined)
  assert.equal(response.data.byteLength, 2)
})

test('retries prepare fresh native requests instead of reusing consumed stream URLs', async () => {
  const f = fixture()
  await f.request(manifest, get, 0).promise
  await f.request(manifest, get, 0).promise
  assert.deepEqual(f.fetched.map(r => r.url), ['/_opentubex_sabr/request-1', '/_opentubex_sabr/request-2'])
})

test('aborting while prepare is pending releases the native request without starting fetch', async () => {
  let release
  const f = fixture({ prepare: () => new Promise(resolve => { release = resolve }) })
  const operation = f.request(manifest, get, 0)
  const rejected = assert.rejects(operation.promise)
  await operation.abort()
  release({ requestId: 'pending' })
  await rejected
  assert.deepEqual(f.aborted, ['pending'])
  assert.equal(f.fetched.length, 0)
})

test('active stream abortion reaches both WebKit and native transport', async () => {
  const f = fixture()
  const operation = f.request(manifest, get, 0)
  await operation.promise
  await operation.abort()
  assert.equal(f.fetchAborts, 1)
  assert.deepEqual(f.aborted, ['request-1'])
})

test('unrelated hosts, HTTP and non-GET media requests keep the standard transport', async () => {
  const f = fixture()
  for (const url of ['https://example.org/video', 'https://googlevideo.com.attacker.invalid/video', 'http://rr1.googlevideo.com/video']) {
    await f.request(url, get, 0).promise
  }
  await f.request(manifest, { ...get, method: 'POST' }, 0).promise
  assert.equal(f.prepared.length, 0)
  assert.equal(f.fetched.length, 4)
})
