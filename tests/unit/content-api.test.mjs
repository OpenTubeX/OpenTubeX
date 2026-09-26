import assert from 'node:assert/strict'
import test from 'node:test'
import { createContentApi } from '../../src/renderer/helpers/api/createContentApi.js'

function makeApi (overrides = {}) {
  return createContentApi({
    localAvailable: true,
    getLocalPost: async () => ({ postId: 'local' }),
    getInvidiousPost: async () => ({ postId: 'invidious' }),
    getLocalHashtag: async () => ({ videos: [{ id: 'local' }], has_continuation: false }),
    getInvidiousHashtag: async () => [{ videoId: 'invidious' }],
    parseLocalVideo: video => ({ videoId: video.id }),
    getLocalPlaylist: async () => ({
      info: {
        title: 'Local list',
        description: '',
        thumbnails: [{ url: 'local.jpg' }],
        views: '1,000',
        total_items: '2',
        author: { name: 'Creator', id: 'channel', best_thumbnail: { url: 'avatar.jpg' } },
      },
      items: [{ id: 'one' }],
      has_continuation: true,
    }),
    getLocalPlaylistContinuation: async () => ({ items: [{ id: 'two' }], has_continuation: false }),
    parseLocalPlaylistVideos: items => items.map(item => ({ videoId: item.id })),
    getInvidiousPlaylist: async () => ({
      title: 'Invidious list',
      description: '',
      videos: [{ videoId: 'one' }],
      viewCount: 1000,
      videoCount: 2,
      author: 'Creator',
      authorId: 'channel',
      authorThumbnails: [{ url: 'avatar.jpg' }],
      updated: 1000,
      pageVideoCount: 1,
    }),
    parseCount: text => Number(text.replace(/\D/g, '')),
    mapInvidiousImage: url => `proxy:${url}`,
    hasMoreInvidiousPages: (count, _page, loaded, pageCount) => pageCount > 0 && loaded < count,
    mergeInvidiousVideos: (current, next) => current.concat(next),
    getCacheableLocalPlaylistContinuation: data => ({ cached: data.info.title }),
    getInvidiousChannelVideos: async () => ({ videos: [{ videoId: 'remote' }], continuation: 'next' }),
    parseLocalChannelVideos: videos => videos,
    makeChannelPlaylistId: () => 'uploads',
    ...overrides,
  })
}

test('content API selects the available provider and returns a post', async () => {
  const calls = []
  const api = makeApi({
    localAvailable: false,
    getInvidiousPost: async (id, authorId) => {
      calls.push([id, authorId])
      return { postId: id, authorId }
    },
  })
  assert.deepEqual(await api.getPost({ id: 'post-1', authorId: 'author-1', preference: 'local' }), {
    provider: 'invidious',
    data: { postId: 'post-1', authorId: 'author-1' },
  })
  assert.deepEqual(calls, [['post-1', 'author-1']])
})

test('content API reports first provider error and hands off once', async () => {
  const failure = new Error('Local failed')
  const events = []
  const api = makeApi({ getLocalPost: async () => { throw failure } })
  const result = await api.getPost({
    id: 'post-1',
    preference: 'local',
    fallback: true,
    onError: (provider, error) => events.push(['error', provider, error]),
    onFallback: (from, to) => events.push(['fallback', from, to]),
  })
  assert.equal(result.provider, 'invidious')
  assert.deepEqual(events, [['error', 'local', failure], ['fallback', 'local', 'invidious']])
})

test('content API does not retry after fallback fails', async () => {
  const calls = []
  const failure = new Error('Invidious failed')
  const api = makeApi({
    getLocalPost: async () => { calls.push('local'); throw Error('Local failed') },
    getInvidiousPost: async () => { calls.push('invidious'); throw failure },
  })
  await assert.rejects(api.getPost({ id: 'post-1', preference: 'local', fallback: true }), error => error === failure)
  assert.deepEqual(calls, ['local', 'invidious'])
})

test('content API normalizes hashtag pages and retains Local continuation', async () => {
  const continuation = { videos: [{ id: 'two' }], has_continuation: false }
  const initial = { videos: [{ id: 'one' }], has_continuation: true, getContinuation: async () => continuation }
  const api = makeApi({ getLocalHashtag: async () => initial })
  const first = await api.getHashtagPage({ hashtag: 'test', preference: 'local' })
  assert.deepEqual(first.videos, [{ videoId: 'one' }])
  assert.equal(first.hasMore, true)
  const second = await api.getHashtagPage({ hashtag: 'test', preference: 'local', cursor: first.cursor })
  assert.deepEqual(second.videos, [{ videoId: 'two' }])
  assert.equal(second.hasMore, false)
})

test('content API starts the fallback hashtag at page one', async () => {
  const calls = []
  const api = makeApi({
    getLocalHashtag: async () => { throw Error('Local failed') },
    getInvidiousHashtag: async (_hashtag, page) => { calls.push(page); return [{ videoId: 'one' }] },
  })
  const result = await api.getHashtagPage({
    hashtag: 'test',
    preference: 'local',
    fallback: true,
    cursor: { provider: 'local', data: { getContinuation: async () => { throw Error('Local failed') } } },
  })
  assert.equal(result.provider, 'invidious')
  assert.equal(result.reset, true)
  assert.deepEqual(calls, [1])
  assert.deepEqual(result.cursor, { provider: 'invidious', page: 2 })
})

test('content API gives Playlist a common initial model and cursor', async () => {
  const api = makeApi()
  const first = await api.getPlaylist({ id: 'PL1', preference: 'local' })
  assert.equal(first.provider, 'local')
  assert.equal(first.title, 'Local list')
  assert.equal(first.channelName, 'Creator')
  assert.equal(first.videoCount, 2)
  assert.deepEqual(first.videos, [{ videoId: 'one' }])
  assert.equal(first.cursor.provider, 'local')
  const second = await api.getPlaylistPage({ id: 'PL1', cursor: first.cursor, videos: first.videos, videoCount: first.videoCount })
  assert.deepEqual(second.videos, [{ videoId: 'two' }])
  assert.equal(second.cursor, null)
  assert.deepEqual(api.getCacheablePlaylistContinuation(first.cursor), { cached: 'Local list' })
  assert.equal(api.getCacheablePlaylistContinuation(null), null)
})

test('content API maps Invidious playlist metadata and page overlap through adapters', async () => {
  const calls = []
  const api = makeApi({
    getInvidiousPlaylist: async (_id, page) => {
      calls.push(page || 1)
      return {
        title: 'Invidious list',
        description: '',
        videos: [{ videoId: page ? 'two' : 'one' }],
        viewCount: 10,
        videoCount: 2,
        author: 'Creator',
        authorId: 'channel',
        authorThumbnails: [{ url: 'avatar.jpg' }],
        updated: 1000,
        pageVideoCount: 1,
      }
    },
  })
  const first = await api.getPlaylist({ id: 'PL1', preference: 'invidious' })
  assert.equal(first.channelThumbnail, 'proxy:avatar.jpg')
  assert.equal(first.subscriptionThumbnail, 'avatar.jpg')
  assert.equal(first.lastUpdatedDate.getTime(), 1000000)
  assert.equal(first.cursor.page, 2)
  assert.equal(api.getCacheablePlaylistContinuation(first.cursor), null)
  const second = await api.getPlaylistPage({ id: 'PL1', cursor: first.cursor, videos: first.videos, videoCount: first.videoCount })
  assert.deepEqual(second.videos, [{ videoId: 'one' }, { videoId: 'two' }])
  assert.equal(second.cursor, null)
  assert.deepEqual(calls, [1, 2])
})

test('content API falls back once for initial playlist metadata', async () => {
  const events = []
  const api = makeApi({ getLocalPlaylist: async () => { throw Error('Local unavailable') } })
  const result = await api.getPlaylist({
    id: 'PL1',
    preference: 'local',
    fallback: true,
    onError: provider => events.push(`error:${provider}`),
    onFallback: (from, to) => events.push(`${from}:${to}`),
  })
  assert.equal(result.provider, 'invidious')
  assert.deepEqual(events, ['error:local', 'local:invidious'])
})

test('content API normalizes Channel video pages and keeps backend cursors private', async () => {
  const second = { videos: [{ videoId: 'local-two' }], has_continuation: false }
  const first = {
    videos: [{ videoId: 'local-one' }],
    has_continuation: true,
    filters: ['newest', 'popular'],
    getContinuation: async () => second,
  }
  const api = makeApi()
  const channel = { getVideos: async () => first }
  const initial = await api.getChannelVideosPage({
    id: 'channel',
    channelName: 'Creator',
    provider: 'local',
    channel,
    sort: 'newest',
    sortValues: ['newest', 'popular'],
  })
  assert.deepEqual(initial.videos, [{ videoId: 'local-one' }])
  assert.equal(initial.canSort, true)
  assert.equal(initial.cursor.provider, 'local')
  const more = await api.getChannelVideosPage({
    id: 'channel',
    channelName: 'Creator',
    provider: 'local',
    channel,
    sort: 'newest',
    sortValues: ['newest', 'popular'],
    cursor: initial.cursor,
  })
  assert.deepEqual(more.videos, [{ videoId: 'local-two' }])
  assert.equal(more.cursor, null)
})

test('content API uses the upload playlist for artist topic videos', async () => {
  const api = makeApi()
  const result = await api.getChannelVideosPage({
    id: 'channel',
    channelName: 'Creator',
    provider: 'local',
    artistTopic: true,
    sort: 'newest',
    sortValues: ['newest', 'popular'],
  })
  assert.deepEqual(result.videos, [{ videoId: 'one' }])
  assert.equal(result.cursor.kind, 'artist')
})

test('content API normalizes Invidious Channel video pages', async () => {
  const api = makeApi()
  const result = await api.getChannelVideosPage({
    id: 'channel', provider: 'invidious', sort: 'newest',
  })
  assert.deepEqual(result.videos, [{ videoId: 'remote' }])
  assert.deepEqual(result.cursor, { provider: 'invidious', data: 'next' })
})
