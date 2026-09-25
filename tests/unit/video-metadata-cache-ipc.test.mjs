import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerVideoMetadataCacheIpc } from '../../src/main/videoMetadataCacheIpc.js'

const trustedUrl = 'app://bundle/index.html'
const videoId = 'abcdefghijk'

function setup(overrides = {}) {
  const handlers = new Map()
  const messages = []
  const calls = []
  const window = {
    webContents: {
      isDestroyed: () => false,
      getURL: () => trustedUrl,
      send: (...args) => messages.push(args)
    }
  }
  registerVideoMetadataCacheIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isTrustedUrl: url => url === trustedUrl,
    resolveHost: async () => ({ endpoints: [{ address: '8.8.8.8' }] }),
    fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    getDefaultInvidiousInstance: async () => null,
    updateCache: async value => { calls.push(['update', value]); return value },
    clearCache: async () => calls.push(['clear']),
    getCacheSize: async () => 42,
    getWindows: () => [window],
    ...overrides
  })
  return { handlers, messages, calls }
}

test('video metadata IPC validates sender and video ID before fetching', async () => {
  let fetchCount = 0
  const { handlers } = setup({ fetch: async () => { fetchCount += 1; return new Response() } })
  const update = handlers.get(IpcChannels.VIDEO_METADATA_CACHE_UPDATE)
  assert.equal(await update({ senderFrame: { url: 'https://example.com' } }, { videoId }), null)
  assert.equal(await update({ senderFrame: { url: trustedUrl } }, { videoId: 'invalid' }), null)
  assert.equal(fetchCount, 0)
})

test('video metadata IPC rejects private thumbnail hosts except the configured instance', async () => {
  const privateHost = async () => ({ endpoints: [{ address: '127.0.0.1' }] })
  const blocked = setup({ resolveHost: privateHost })
  const event = { senderFrame: { url: trustedUrl } }
  const metadata = { videoId, thumbnailUrl: 'http://localhost/thumb.png' }
  assert.equal((await blocked.handlers.get(IpcChannels.VIDEO_METADATA_CACHE_UPDATE)(event, metadata)).thumbnail, null)

  const allowed = setup({
    resolveHost: privateHost,
    getDefaultInvidiousInstance: async () => 'http://localhost'
  })
  assert.equal(
    (await allowed.handlers.get(IpcChannels.VIDEO_METADATA_CACHE_UPDATE)(event, metadata)).thumbnail,
    'data:image/png;base64,AQID'
  )
})

test('clearing the cache invalidates an in-flight thumbnail and broadcasts to trusted windows', async () => {
  let releaseFetch
  const fetchPending = new Promise(resolve => { releaseFetch = resolve })
  const { handlers, calls, messages } = setup({ fetch: () => fetchPending })
  const event = { senderFrame: { url: trustedUrl } }
  const pendingUpdate = handlers.get(IpcChannels.VIDEO_METADATA_CACHE_UPDATE)(event, {
    videoId,
    thumbnailUrl: 'https://example.com/thumb.png'
  })
  assert.equal(await handlers.get(IpcChannels.VIDEO_METADATA_CACHE_CLEAR)(event), true)
  releaseFetch(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }))
  assert.equal(await pendingUpdate, null)
  assert.deepEqual(calls, [['clear']])
  assert.deepEqual(messages, [[IpcChannels.VIDEO_METADATA_CACHE_CLEARED]])
  assert.equal(await handlers.get(IpcChannels.VIDEO_METADATA_CACHE_GET_SIZE)(event), 42)
})
