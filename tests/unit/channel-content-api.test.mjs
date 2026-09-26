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
    parseLocalHeader: () => ({
      id: 'local-id',
      name: 'Local creator',
      thumbnailUrl: '//local/avatar',
      bannerUrl: 'local/banner',
      tags: ['music', 'music'],
      subscriberText: '100',
    }),
    parseSubscriberCount: text => Number(text),
    getAgeGate: () => null,
    mayContainOtherChannels: () => false,
    mapImage: url => url,
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
    getVideosPage: async () => ({ videos: [{ videoId: 'video' }], cursor: null, canSort: null }),
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

test('channel API normalizes Local overview capabilities and metadata', async () => {
  const api = makeApi({
    getLocalChannel: async () => ({
      metadata: { is_family_safe: true },
      tabs: ['Videos'],
      has_about: true,
      has_videos: true,
      has_shorts: true,
      has_home: false,
      has_search: true,
    }),
  })
  const result = await api.getOverview({ id: 'channel', provider: 'local' })
  assert.equal(result.name, 'Local creator')
  assert.equal(result.thumbnail, 'https://local/avatar')
  assert.equal(result.subscriberCount, 100)
  assert.deepEqual(result.tags, ['music'])
  assert.deepEqual(result.availableTabs, ['about', 'videos', 'shorts'])
  assert.equal(result.aboutPending, true)
  assert.equal(result.showSearchBar, true)
})

test('channel API reuses the current Local channel session', async () => {
  let requests = 0
  const api = makeApi({ getLocalChannel: async () => { requests++; throw Error('unexpected fetch') } })
  const result = await api.getOverview({
    id: 'channel',
    provider: 'local',
    existingChannel: { metadata: {}, tabs: ['Videos'], has_videos: true },
  })
  assert.equal(result.provider, 'local')
  assert.equal(requests, 0)
})

test('channel API returns an age gate before parsing the Local header', async () => {
  const api = makeApi({
    getAgeGate: () => ({ name: 'Restricted', thumbnail: 'age.jpg' }),
    parseLocalHeader: () => { throw Error('header should not be parsed') },
  })
  const result = await api.getOverview({ id: 'channel', provider: 'local' })
  assert.equal(result.kind, 'age-gate')
  assert.equal(result.name, 'Restricted')
})

test('channel API normalizes Invidious overview metadata and related channels', async () => {
  const api = makeApi({
    getInvidiousChannel: async () => ({
      author: 'Remote creator',
      authorId: 'remote-id',
      isFamilyFriendly: true,
      subCount: 50,
      authorThumbnails: [{ url: 'avatar' }],
      description: 'Description',
      totalViews: 1000,
      joined: 10,
      relatedChannels: [{
        author: 'Related', authorId: 'related-id', authorThumbnails: [{ url: 'related-avatar' }],
      }],
      authorBanners: [{ url: 'banner' }],
      tabs: ['videos', 'playlists', 'about'],
    }),
    mapImage: url => `proxy:${url}`,
  })
  const result = await api.getOverview({ id: 'channel', provider: 'invidious' })
  assert.equal(result.name, 'Remote creator')
  assert.equal(result.routeId, 'remote-id')
  assert.equal(result.thumbnail, 'proxy:avatar')
  assert.deepEqual(result.relatedChannels, [{ name: 'Related', id: 'related-id', thumbnailUrl: 'proxy:related-avatar' }])
  assert.deepEqual(result.availableTabs, ['videos', 'playlists', 'about'])
})

test('channel API owns overview selection and a single fallback handoff', async () => {
  const calls = []
  const api = makeApi({
    getLocalChannel: async () => { calls.push('local'); throw Error('offline') },
    getInvidiousChannel: async () => {
      calls.push('invidious')
      return { author: 'Remote', authorId: 'id', authorThumbnails: [], relatedChannels: [], tabs: [] }
    },
  })
  const result = await api.loadOverview({
    id: 'channel',
    preference: 'local',
    fallback: true,
    onSelected: provider => calls.push(`selected:${provider}`),
    onError: provider => calls.push(`error:${provider}`),
    onFallback: (from, to) => calls.push(`${from}:${to}`),
  })
  assert.equal(result.provider, 'invidious')
  assert.deepEqual(calls, [
    'selected:local', 'local', 'error:local', 'local:invidious',
    'selected:invidious', 'invidious',
  ])
})

test('channel API reports both provider failures without retrying either provider', async () => {
  const calls = []
  const failure = Error('second provider failed')
  const api = makeApi({
    getLocalChannel: async () => { calls.push('local'); throw Error('first provider failed') },
    getInvidiousChannel: async () => { calls.push('invidious'); throw failure },
  })
  await assert.rejects(api.loadOverview({
    id: 'channel',
    preference: 'local',
    fallback: true,
    onError: provider => calls.push(`error:${provider}`),
  }), error => error === failure)
  assert.deepEqual(calls, ['local', 'error:local', 'invidious', 'error:invidious'])
})

test('channel API discards a stale overview before reporting an error or fallback', async () => {
  const calls = []
  const api = makeApi({
    getLocalChannel: async () => { throw Error('stale request') },
  })
  const result = await api.loadOverview({
    id: 'channel',
    preference: 'local',
    fallback: true,
    isCurrent: () => false,
    onError: () => calls.push('error'),
    onFallback: () => calls.push('fallback'),
  })
  assert.equal(result, null)
  assert.deepEqual(calls, [])
})

test('channel API loads a section from the selected provider and falls back once', async () => {
  const calls = []
  const api = makeApi({
    getLocalChannel: async () => ({ getCommunity: async () => { calls.push('local'); throw Error('offline') } }),
    getInvidiousSection: async () => { calls.push('invidious'); return { posts: [{ id: 'remote' }] } },
  })
  const result = await api.loadPage({
    section: 'community',
    id: 'channel',
    preference: 'local',
    fallback: true,
    onError: provider => calls.push(`error:${provider}`),
    onFallback: (from, to) => calls.push(`${from}:${to}`),
  })
  assert.equal(result.provider, 'invidious')
  assert.deepEqual(result.items, [{ id: 'remote' }])
  assert.deepEqual(calls, ['local', 'error:local', 'local:invidious', 'invidious'])
})

test('channel API keeps continuation on its provider without fallback', async () => {
  const calls = []
  const api = makeApi({
    getInvidiousSection: async () => { calls.push('invidious'); throw Error('page failed') },
    getLocalChannel: async () => { calls.push('local'); throw Error('must not run') },
  })
  await assert.rejects(api.loadPage({
    section: 'community',
    id: 'channel',
    preference: 'local',
    fallback: true,
    cursor: { provider: 'invidious', section: 'community', data: 'next' },
    more: true,
    onError: provider => calls.push(`error:${provider}`),
  }), /page failed/)
  assert.deepEqual(calls, ['invidious', 'error:invidious'])
})

test('channel API ignores a stale search failure without reporting or falling back', async () => {
  const calls = []
  let current = true
  const api = makeApi({
    getInvidiousSearch: async () => {
      current = false
      throw Error('stale search')
    },
    getLocalChannel: async () => { calls.push('local'); throw Error('must not run') },
  })
  const result = await api.loadPage({
    section: 'search',
    id: 'channel',
    preference: 'invidious',
    fallback: true,
    isCurrent: () => current,
    onError: provider => calls.push(`error:${provider}`),
    onFallback: () => calls.push('fallback'),
  })
  assert.equal(result, null)
  assert.deepEqual(calls, [])
})

test('channel API fetches a Local session before loading a section', async () => {
  const calls = []
  const api = makeApi({
    getLocalChannel: async () => {
      calls.push('session')
      return { getCommunity: async () => { calls.push('community'); return { posts: [{ id: 'post' }] } } }
    },
  })
  const result = await api.loadPage({ section: 'community', id: 'channel', preference: 'local' })
  assert.deepEqual(result.items, [{ id: 'post' }])
  assert.deepEqual(calls, ['session', 'community'])
})

test('channel API delegates Local stream fallback to the overview once', async () => {
  const calls = []
  const api = makeApi({
    getLocalChannel: async () => ({ getShorts: async () => { throw Error('offline') } }),
    getInvidiousSection: async () => { calls.push('invidious'); return { videos: [] } },
  })
  const result = await api.loadPage({
    section: 'shorts',
    id: 'channel',
    preference: 'local',
    fallback: true,
    onOverviewFallback: provider => calls.push(`overview:${provider}`),
  })
  assert.equal(result, null)
  assert.deepEqual(calls, ['overview:local'])
})

test('channel API reports an initial Local stream failure to the overview without a fallback provider', async () => {
  const calls = []
  const api = makeApi({
    getLocalChannel: async () => ({ getLiveStreams: async () => { throw Error('offline') } }),
  })
  const result = await api.loadPage({
    section: 'live',
    id: 'channel',
    preference: 'local',
    fallback: false,
    onError: provider => calls.push(`error:${provider}`),
    onOverviewFallback: provider => calls.push(`overview:${provider}`),
  })
  assert.equal(result, null)
  assert.deepEqual(calls, ['error:local', 'overview:local'])
})

test('channel API delegates Local video failure to overview and leaves More on its provider', async () => {
  const calls = []
  const api = makeApi({
    getLocalChannel: async () => ({ id: 'session' }),
    getVideosPage: async ({ provider }) => { calls.push(provider); throw Error('offline') },
  })
  const initial = await api.loadVideosPage({
    id: 'channel',
    preference: 'local',
    fallback: true,
    sort: 'newest',
    onOverviewFallback: provider => calls.push(`overview:${provider}`),
  })
  assert.equal(initial, null)
  await assert.rejects(api.loadVideosPage({
    id: 'channel',
    preference: 'local',
    fallback: true,
    provider: 'invidious',
    more: true,
    cursor: { provider: 'invidious', data: 'next' },
    sort: 'newest',
  }), /offline/)
  assert.deepEqual(calls, ['local', 'overview:local', 'invidious'])
})

test('channel API reports an initial Local video failure to the overview without a fallback provider', async () => {
  const calls = []
  const api = makeApi({
    getVideosPage: async () => { throw Error('offline') },
  })
  const result = await api.loadVideosPage({
    id: 'channel',
    preference: 'local',
    fallback: false,
    sort: 'newest',
    onError: provider => calls.push(`error:${provider}`),
    onOverviewFallback: provider => calls.push(`overview:${provider}`),
  })
  assert.equal(result, null)
  assert.deepEqual(calls, ['error:local', 'overview:local'])
})

test('channel API only suppresses missing artist playlists on the first page', async () => {
  const calls = []
  const api = makeApi({
    getVideosPage: async () => { throw Error('The playlist does not exist.') },
  })
  const first = await api.loadVideosPage({
    id: 'channel',
    preference: 'local',
    artistTopic: true,
    sort: 'newest',
    onError: provider => calls.push(provider),
  })
  assert.equal(first, null)
  await assert.rejects(api.loadVideosPage({
    id: 'channel',
    preference: 'local',
    artistTopic: true,
    sort: 'newest',
    more: true,
    cursor: { provider: 'local', data: 'next' },
    onError: provider => calls.push(provider),
  }), /The playlist does not exist\./)
  assert.deepEqual(calls, ['local'])
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

test('channel API falls back from Invidious search to Local search once', async () => {
  const calls = []
  const api = makeApi({
    getInvidiousSearch: async () => { calls.push('invidious'); throw Error('offline') },
    getLocalChannel: async () => ({
      has_search: true,
      search: async () => {
        calls.push('local')
        return {
          current_tab: {
            content: {
              contents: [{
                type: 'ItemSection',
                contents: [{ type: 'Video', videoId: 'one' }],
              }],
            },
          },
          has_continuation: false,
        }
      },
    }),
  })
  const result = await api.loadPage({
    section: 'search',
    id: 'channel',
    preference: 'invidious',
    fallback: true,
    query: 'test',
    onFallback: (from, to) => calls.push(`${from}:${to}`),
  })
  assert.equal(result.provider, 'local')
  assert.deepEqual(result.items, [{ type: 'Video', videoId: 'one', channelSearchResultType: 'video' }])
  assert.deepEqual(calls, ['invidious', 'invidious:local', 'local'])
})
