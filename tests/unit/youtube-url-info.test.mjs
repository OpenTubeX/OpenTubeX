import assert from 'node:assert/strict'
import test from 'node:test'

import { parseYoutubeUrlInfo } from '../../src/renderer/helpers/youtubeUrlInfo.js'

const options = {
  getVideoParamsFromUrl: url => ({
    videoId: url.includes('/watch?v=') ? 'dQw4w9WgXcQ' : null,
    playlistId: url.includes('/watch?v=') ? 'PL123' : null,
    timestamp: null,
    commentId: null,
    isShort: false
  }),
  checkYoutubeChannelId: id => /^UC[\w-]{22}$/.test(id),
  searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
  backendPreference: 'local',
  hideChannelHome: false,
  supportsLocalApi: true
}

test('resolves video and playlist links without changing their result shape', () => {
  assert.deepEqual(parseYoutubeUrlInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', options), {
    urlType: 'video',
    videoId: 'dQw4w9WgXcQ',
    playlistId: 'PL123',
    timestamp: null,
    commentId: null,
    isShort: false
  })
  assert.deepEqual(parseYoutubeUrlInfo('https://www.youtube.com/playlist?list=PL123&index=2', options), {
    urlType: 'playlist', playlistId: 'PL123', query: { index: '2' }
  })
})

test('resolves channel handles and uses the configured default tab', () => {
  assert.deepEqual(parseYoutubeUrlInfo('@example', options), {
    urlType: 'channel',
    channelId: '@example',
    subPath: 'home',
    url: 'https://www.youtube.com/@example'
  })
  assert.equal(parseYoutubeUrlInfo('https://www.youtube.com/@example', {
    ...options, backendPreference: 'invidious'
  }).subPath, 'videos')
  assert.equal(parseYoutubeUrlInfo('https://www.youtube.com/@example/shorts', options).subPath, 'shorts')
})

test('resolves community post links and feed aliases', () => {
  assert.deepEqual(parseYoutubeUrlInfo('https://www.youtube.com/channel/UC1234567890123456789012/community?lb=post-1', options), {
    urlType: 'post', postId: 'post-1', query: { authorId: 'UC1234567890123456789012' }
  })
  assert.deepEqual(parseYoutubeUrlInfo('https://www.youtube.com/feed/library', options), {
    urlType: 'userplaylists'
  })
  assert.deepEqual(parseYoutubeUrlInfo('https://www.youtube.com/feed/trending', {
    ...options, supportsLocalApi: false
  }), { urlType: 'unknown' })
})

test('preserves search filters and rejects invalid or unrecognized links', () => {
  assert.deepEqual(parseYoutubeUrlInfo('https://www.youtube.com/results?search_query=cats&sort=views', options), {
    urlType: 'search',
    searchQuery: 'cats',
    query: { ...options.searchSettings, sort: 'views' }
  })
  assert.deepEqual(parseYoutubeUrlInfo('not a URL', options), { urlType: 'invalid_url' })
  assert.deepEqual(parseYoutubeUrlInfo('https://www.youtube.com/other/path', options), { urlType: 'unknown' })
})
