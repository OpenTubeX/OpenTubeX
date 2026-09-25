import assert from 'node:assert/strict'
import test from 'node:test'
import { createVideoApi } from '../../src/renderer/helpers/api/createVideoApi.js'
import { mapLocalWatchVideo, mapInvidiousWatchVideo } from '../../src/renderer/helpers/api/watchVideoModel.js'

test('watch video requests expose one application model for either provider', async () => {
  const calls = []
  const api = createVideoApi({
    loadLocal: async id => { calls.push(['local', id]); return { info: { basic_info: { title: 'Local title' } } } },
    loadInvidious: async id => { calls.push(['invidious', id]); return { title: 'Invidious title' } },
    mapLocal: response => ({ title: response.info.basic_info.title }),
    mapInvidious: response => ({ title: response.title }),
  })

  const local = await api.getWatchVideoInformation('one', 'local', {})
  const invidious = await api.getWatchVideoInformation('two', 'invidious', { instanceUrl: 'https://invidious.example' })
  assert.deepEqual(local, { provider: 'local', metadata: { title: 'Local title' }, source: { info: { basic_info: { title: 'Local title' } } } })
  assert.deepEqual(invidious, { provider: 'invidious', metadata: { title: 'Invidious title' }, source: { title: 'Invidious title' } })
  assert.deepEqual(calls, [['local', 'one'], ['invidious', 'two']])
})

test('Invidious watch metadata requires an instance URL at the API boundary', async () => {
  const api = createVideoApi({
    loadLocal: async () => null,
    loadInvidious: async () => ({ title: 'Video' }),
    mapLocal: () => null,
    mapInvidious: () => ({ title: 'Video' }),
  })
  await assert.rejects(api.getWatchVideoInformation('video', 'invidious', {}), TypeError)
})

test('watch video mapping propagates provider failures unchanged', async () => {
  const failure = new Error('unavailable')
  const api = createVideoApi({
    loadLocal: async () => { throw failure },
    loadInvidious: async () => null,
    mapLocal: () => null,
    mapInvidious: () => null,
  })
  await assert.rejects(api.getWatchVideoInformation('one', 'local', {}), error => error === failure)
})

test('Local and Invidious metadata share an application-facing shape', () => {
  const local = mapLocalWatchVideo({
    info: {
      basic_info: { title: 'Local title', short_description: 'Local description', duration: 42, view_count: 0, channel_id: 'channel', author: 'Author', category: 'Music', keywords: ['song'] },
      page: [],
    },
    musicMediaType: 'song',
  }, { videoId: 'video123', avoidTranslation: true })
  const invidious = mapInvidiousWatchVideo({
    title: 'Invidious title',
    description: 'Invidious description',
    lengthSeconds: 42,
    viewCount: 0,
    authorId: 'channel',
    author: 'Author',
    authorThumbnails: [],
    videoThumbnails: [{ url: '/vi/video123/default.jpg' }],
    subCountText: '',
    genre: 'Music',
    keywords: ['song'],
    published: 10,
    liveNow: false,
    isFamilyFriendly: true,
    isListed: true,
  }, { videoId: 'video123', instanceUrl: 'https://invidious.example' })

  for (const model of [local, invidious]) {
    assert.equal(model.viewCount, 0)
    assert.equal(model.durationSeconds, 42)
    assert.equal(model.channel.id, 'channel')
    assert.equal(model.channel.name, 'Author')
    assert.equal(model.category, 'Music')
    assert.deepEqual(model.tags, ['song'])
  }
  assert.equal(local.title, 'Local title')
  assert.equal(invidious.title, 'Invidious title')
  assert.equal(invidious.published, 10000)
})

test('Local metadata tolerates a private response without watch panels', () => {
  const metadata = mapLocalWatchVideo({
    info: { playability_status: { status: 'LOGIN_REQUIRED' }, basic_info: { title: 'Private video' } },
  }, { videoId: 'private123' })
  assert.equal(metadata.title, 'Private video')
  assert.equal(metadata.channel.id, '')
})

test('private live metadata without a start time reaches the private-video handler', () => {
  const metadata = mapLocalWatchVideo({
    info: {
      playability_status: { status: 'LOGIN_REQUIRED', error_screen: { reason: { text: 'Private video' } } },
      basic_info: { title: 'Private live video', is_live: true, is_live_content: false },
    },
  }, { videoId: 'privateLive123' })
  assert.equal(metadata.isLive, true)
  assert.equal(metadata.published, 0)
})
