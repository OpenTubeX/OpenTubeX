import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'

import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const state = {
  proxy: 'DIRECT',
  /** @type {string[][]} */
  resolutions: [],
  /** @type {object[]} */
  connections: [],
  /** @type {string[]} */
  netFetches: []
}

const [{ fetchVideoMetadataThumbnailHop }] = await importWithStubs(
  [sourceUrl('src/main/videoMetadataCache.js')],
  {
    electron: {
      net: {
        fetch: async url => {
          state.netFetches.push(url)
          return new Response('proxied', { headers: { 'content-type': 'image/png' } })
        }
      },
      session: {
        defaultSession: {
          resolveProxy: async () => state.proxy,
          // Each lookup returns the next answer, so a second one would rebind.
          resolveHost: async () => ({ endpoints: state.resolutions.shift().map(address => ({ address })) }),
          getUserAgent: () => 'OpenTubeX test'
        }
      }
    },
    'node:https': {
      request(options) {
        options.lookup(options.hostname, { all: true }, (error, addresses) => {
          state.connections.push({ hostname: options.hostname, error, addresses })
        })
        const request = new EventEmitter()
        request.setHeader = () => {}
        request.end = () => queueMicrotask(() => {
          const incoming = Readable.from([Buffer.from('direct')])
          incoming.statusCode = 200
          incoming.headers = { 'content-type': 'image/png' }
          request.emit('response', incoming)
        })
        request.destroy = () => {}
        return request
      }
    },
    [sourceUrl('src/datastores/index.js')]: { settings: {}, videoMetadataCache: {} },
    [sourceUrl('src/datastores/sqliteNode.js')]: { desktopDatastorePaths: () => [] }
  },
  { electron: ['app', 'BrowserWindow', 'ipcMain'] }
)

test.beforeEach(() => {
  state.proxy = 'DIRECT'
  state.resolutions = []
  state.connections = []
  state.netFetches = []
})

test('direct thumbnail requests connect to the validated address instead of resolving again', async () => {
  state.resolutions = [['93.184.216.34'], ['127.0.0.1']]

  const response = await fetchVideoMetadataThumbnailHop(new URL('https://thumbnails.test/hq.jpg'), null, new AbortController().signal)

  assert.equal(await response.text(), 'direct')
  assert.deepEqual(state.connections, [{ hostname: 'thumbnails.test', error: null, addresses: [{ address: '93.184.216.34', family: 4 }] }])
  assert.deepEqual(state.resolutions, [['127.0.0.1']])
  assert.deepEqual(state.netFetches, [])
})

test('direct thumbnail requests refuse hosts that resolve to private addresses', async () => {
  state.resolutions = [['192.168.1.1']]

  assert.equal(await fetchVideoMetadataThumbnailHop(new URL('https://thumbnails.test/hq.jpg'), null, new AbortController().signal), null)
  assert.deepEqual(state.connections, [])
  assert.deepEqual(state.netFetches, [])
})

test('proxied thumbnail requests go through the proxy instead of a pinned direct connection', async () => {
  state.proxy = 'PROXY proxy.test:8080'
  state.resolutions = [['93.184.216.34']]

  const response = await fetchVideoMetadataThumbnailHop(new URL('https://thumbnails.test/hq.jpg'), null, new AbortController().signal)

  assert.equal(await response.text(), 'proxied')
  assert.deepEqual(state.netFetches, ['https://thumbnails.test/hq.jpg'])
  assert.deepEqual(state.connections, [])
})
