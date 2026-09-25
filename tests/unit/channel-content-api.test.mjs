import assert from 'node:assert/strict'
import test from 'node:test'
import { createChannelContentApi } from '../../src/renderer/helpers/api/createChannelContentApi.js'

function makeApi (overrides = {}) {
  return createChannelContentApi({
    localAvailable: true,
    getLocalId: async () => 'local-id',
    getInvidiousId: async () => 'remote-id',
    getLocalChannel: async () => ({ id: 'local-channel' }),
    getInvidiousChannel: async () => ({ id: 'remote-channel' }),
    parseShorts: videos => videos,
    parseVideos: videos => videos,
    parsePlaylists: playlists => playlists,
    parsePosts: posts => posts,
    getInvidiousSection: async () => ({ videos: [], playlists: [], continuation: null }),
    getArtistReleases: async () => ({ releases: [], continuationData: null }),
    getArtistReleasesMore: async () => ({ releases: [], continuationData: null }),
    parseSearchVideo: video => video,
    parseSearchPlaylist: playlist => playlist,
    getInvidiousSearch: async () => [],
    getLocalSearchType: () => 'video',
    getInvidiousSearchType: () => 'video',
    ...overrides,
  })
}

test('channel API selects one provider for ID and info requests', async () => {
  const api = makeApi({ localAvailable: false })
  assert.equal(api.resolveProvider('local'), 'invidious')
  assert.equal(await api.getId('https://youtube.com/@creator', 'local'), 'remote-id')
  assert.deepEqual(await api.getInfo('channel', 'invidious'), { id: 'remote-channel' })
  assert.equal(api.getFallbackProvider('invidious', 'invidious', true), null)
})

test('channel API owns overview selection and a single fallback handoff', async () => {
  const api = makeApi()
  const calls = []
  const loadLocal = async () => { calls.push('local'); return 'local' }
  const loadInvidious = async () => { calls.push('invidious'); return 'invidious' }
  const handlers = {
    preference: 'local',
    fallback: true,
    loadLocal,
    loadInvidious,
    onFallback: (from, to) => calls.push(`${from}:${to}`),
  }
  assert.equal(await api.loadOverview(handlers), 'local')
  assert.equal(await api.loadOverview({ ...handlers, failedProvider: 'local' }), 'invidious')
  assert.equal(await api.loadOverview({ ...handlers, failedProvider: 'invidious' }), null)
  assert.deepEqual(calls, ['local', 'local:invidious', 'invidious'])
})

test('channel API normalizes Local shorts and their continuation', async () => {
  const next = { videos: [{ videoId: 'two' }], has_continuation: false }
  const first = {
    videos: [{ videoId: 'one' }],
    filters: ['newest', 'popular'],
    has_continuation: true,
    getContinuation: async () => next,
  }
  const api = makeApi()
  const channel = { getShorts: async () => first }
  const initial = await api.getPage({
    section: 'shorts', provider: 'local', channel, id: 'channel', sort: 'newest',
  })
  assert.deepEqual(initial.items, [{ videoId: 'one' }])
  assert.equal(initial.canSort, true)
  const more = await api.getPage({
    section: 'shorts', provider: 'local', channel, id: 'channel', sort: 'newest', cursor: initial.cursor,
  })
  assert.deepEqual(more.items, [{ videoId: 'two' }])
  assert.equal(more.cursor, null)
})

test('channel API crosses empty Local live continuation pages', async () => {
  const next = { videos: [{ videoId: 'live' }], has_continuation: false }
  const first = {
    videos: [],
    filters: ['newest'],
    has_continuation: true,
    getContinuation: async () => next,
  }
  const api = makeApi()
  const result = await api.getPage({
    section: 'live',
    provider: 'local',
    channel: { getLiveStreams: async () => first },
    id: 'channel',
    sort: 'newest',
  })
  assert.deepEqual(result.items, [{ videoId: 'live' }])
  assert.equal(result.cursor, null)
})

test('channel API maps Invidious playlist pagination', async () => {
  const calls = []
  const api = makeApi({
    getInvidiousSection: async (section, id, sort, continuation) => {
      calls.push([section, id, sort, continuation])
      return { playlists: [{ playlistId: 'PL1' }], continuation: continuation ? null : 'next' }
    },
  })
  const first = await api.getPage({ section: 'playlists', provider: 'invidious', id: 'channel', sort: 'newest' })
  assert.deepEqual(first.items, [{ playlistId: 'PL1' }])
  assert.equal(first.cursor.data, 'next')
  await api.getPage({ section: 'playlists', provider: 'invidious', id: 'channel', sort: 'newest', cursor: first.cursor })
  assert.deepEqual(calls, [
    ['playlists', 'channel', 'newest', null],
    ['playlists', 'channel', 'newest', 'next'],
  ])
})

test('channel API maps Local search results and continuation', async () => {
  const search = {
    current_tab: { content: { contents: [{ type: 'ItemSection', contents: [{ type: 'Video', videoId: 'one' }] }] } },
    has_continuation: false,
  }
  const api = makeApi()
  const result = await api.getPage({
    section: 'search',
    provider: 'local',
    id: 'channel',
    query: 'test',
    channel: { has_search: true, search: async () => search },
  })
  assert.deepEqual(result.items, [{ type: 'Video', videoId: 'one', channelSearchResultType: 'video' }])
  assert.equal(result.cursor, null)
})
