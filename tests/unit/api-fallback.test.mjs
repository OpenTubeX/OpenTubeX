import assert from 'node:assert/strict'
import test from 'node:test'
import { getApiOrder } from '../../src/apiBackends.js'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const events = []
const api = {
  local: { failure: null, result: 'local result' },
  invidious: { failure: null, result: 'invidious result' },
}
function respond(name, value = api[name].result) {
  events.push(name)
  if (api[name].failure) throw api[name].failure
  return value
}

const [{ requestWithFallback }, { getPlaylistSnapshot }, { findChannelTagInfo }] = await importWithStubs([
  sourceUrl('src/renderer/helpers/api/fallback.js'),
  sourceUrl('src/renderer/helpers/api/playlist-snapshot.js'),
  sourceUrl('src/renderer/helpers/channels.js'),
], {
  [sourceUrl('src/renderer/helpers/utils.js')]: {
    showInvidiousFallbackToast: backend => events.push(`${backend} warning`),
  },
  [sourceUrl('src/renderer/helpers/api/local.js')]: {
    getLocalChannel: async () => respond('local', { local: true }),
    getLocalPlaylist: async () => respond('local', {
      info: { title: 'Local', author: {}, total_items: 1 },
      items: [],
      has_continuation: false,
    }),
    parseLocalChannelHeader: () => ({ name: 'Local channel', thumbnailUrl: 'local.jpg' }),
    parseLocalPlaylistVideos: items => items,
  },
  [sourceUrl('src/renderer/helpers/api/invidious.js')]: {
    invidiousGetChannelInfo: async () => respond('invidious', { author: 'Invidious channel', authorThumbnails: [{ url: 'invidious.jpg' }] }),
    invidiousGetPlaylistInfo: async () => respond('invidious', { title: 'Invidious', videos: [], videoCount: 0 }),
  },
}, {
  [sourceUrl('src/renderer/helpers/api/local.js')]: ['getLocalChannelId'],
  [sourceUrl('src/renderer/helpers/api/invidious.js')]: ['invidiousGetChannelId'],
})

const requests = { local: async () => respond('local'), invidious: async () => respond('invidious') }

test.beforeEach(() => {
  events.length = 0
  api.local.failure = null
  api.invidious.failure = null
  process.env.SUPPORTS_LOCAL_API = 'true'
})

test.after(() => {
  delete process.env.SUPPORTS_LOCAL_API
})

test('orders the APIs by preference, fallback setting and build support', () => {
  assert.deepEqual(getApiOrder('local', true, true), ['local', 'invidious'])
  assert.deepEqual(getApiOrder('local', false, true), ['local'])
  assert.deepEqual(getApiOrder('invidious', true, true), ['invidious', 'local'])
  assert.deepEqual(getApiOrder('yattee', true, true), ['invidious', 'local'])
  assert.deepEqual(getApiOrder('yattee', false, true), ['invidious'])
  for (const backend of ['local', 'invidious', 'yattee']) {
    assert.deepEqual(getApiOrder(backend, true, false), ['invidious'])
  }
})

test('a successful request neither falls back nor warns', async () => {
  assert.deepEqual(await requestWithFallback(requests, { backend: 'invidious', fallback: true }),
    { api: 'invidious', result: 'invidious result' })
  assert.deepEqual(events, ['invidious'])
})

test('warns before each fallback that contacts YouTube directly', async () => {
  api.invidious.failure = new Error('Invidious failed')
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await requestWithFallback(requests, { backend: 'invidious', fallback: true }),
      { api: 'local', result: 'local result' })
  }
  assert.deepEqual(events, ['invidious', 'invidious warning', 'local', 'invidious', 'invidious warning', 'local'])
})

test('names the Yattee server in its warning', async () => {
  api.invidious.failure = new Error('Yattee failed')
  await requestWithFallback(requests, { backend: 'yattee', fallback: true })
  assert.deepEqual(events, ['invidious', 'yattee warning', 'local'])
})

test('a fallback to Invidious does not show a direct-connection warning', async () => {
  api.local.failure = new Error('Local failed')
  assert.equal((await requestWithFallback(requests, { backend: 'local', fallback: true })).api, 'invidious')
  assert.deepEqual(events, ['local', 'invidious'])
})

for (const [name, options] of [
  ['the setting is off', { fallback: false }],
  ['the error would repeat', { canFallBack: () => false }],
  ['the request was cancelled', { signal: AbortSignal.abort() }],
]) {
  test(`does not fall back when ${name}`, async () => {
    const failure = api.invidious.failure = new Error('Invidious failed')
    await assert.rejects(requestWithFallback(requests, { backend: 'invidious', fallback: true, ...options }), failure)
    assert.deepEqual(events, ['invidious'])
  })
}

test('builds without the local API only use Invidious', async () => {
  delete process.env.SUPPORTS_LOCAL_API
  assert.equal((await requestWithFallback(requests, { backend: 'local', fallback: true })).api, 'invidious')
  api.invidious.failure = new Error('Invidious failed')
  await assert.rejects(requestWithFallback(requests, { backend: 'local', fallback: true }), api.invidious.failure)
  assert.deepEqual(events, ['invidious', 'invidious'])
})

test('playlist snapshots restart on the other API after a failure', async () => {
  api.invidious.failure = new Error('Invidious failed')
  const snapshot = await getPlaylistSnapshot('PL', { backend: 'invidious', fallback: true, signal: new AbortController().signal })
  assert.equal(snapshot.title, 'Local')
  assert.deepEqual(events, ['invidious', 'invidious warning', 'local'])
})

test('channel tags fall back for failed requests but not for missing channels', async () => {
  const id = 'UC' + 'a'.repeat(22)
  api.invidious.failure = new Error('Invidious failed')
  assert.deepEqual(await findChannelTagInfo(id, { preference: 'invidious', fallback: true }),
    { preferredName: 'Local channel', icon: 'local.jpg', iconHref: `/channel/${id}` })
  assert.deepEqual(events, ['invidious', 'invidious warning', 'local'])

  events.length = 0
  api.invidious.failure = new Error('This channel does not exist.')
  assert.deepEqual(await findChannelTagInfo(id, { preference: 'invidious', fallback: true }), { invalidId: true })
  assert.deepEqual(events, ['invidious'])
})

test('a missing channel reported only by the fallback is an error, not an invalid ID', async t => {
  t.mock.method(console, 'error', () => {})
  const id = 'UC' + 'b'.repeat(22)
  api.invidious.failure = new Error('Invidious failed')
  api.local.failure = new Error('This channel does not exist.')
  const info = await findChannelTagInfo(id, { preference: 'invidious', fallback: true })
  assert.equal(info.err, api.local.failure)
  assert.equal(info.invalidId, undefined)
  assert.deepEqual(events, ['invidious', 'invidious warning', 'local'])
})
