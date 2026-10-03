import assert from 'node:assert/strict'
import test from 'node:test'

import { downloadQueueVideos } from '../../src/renderer/helpers/downloadPlayback.js'

test('queues a downloaded video with its saved-file route and metadata', () => {
  const [video] = downloadQueueVideos({
    id: 42, videoId: 'saved', title: 'Saved video', thumbnail: 'data:image/png;base64,thumbnail',
    files: [{ videoId: 'saved', path: '/downloads/video.webm', author: 'Channel', authorId: 'channel' }],
  })
  assert.deepEqual(video, {
    videoId: 'saved', title: 'Saved video', author: 'Channel', authorId: 'channel',
    thumbnail: 'data:image/png;base64,thumbnail',
    route: { path: '/watch/saved', query: { downloadId: '42' } },
  })
})

test('queues available playlist files in order and keeps their playlist context', () => {
  const videos = downloadQueueVideos({
    id: 7, playlistId: 'playlist', title: 'Playlist title', mode: 'audio',
    files: [
      { videoId: 'first', path: '/downloads/First.m4a', title: 'First track' },
      { videoId: 'missing', path: '/downloads/Missing.m4a', available: false },
      { videoId: 'second', path: '/downloads/Second track.m4a' },
      { path: '/downloads/subtitles.vtt' },
    ],
  })
  assert.deepEqual(videos.map(video => video.title), ['First track', 'Second track'])
  assert.deepEqual(videos.map(video => video.route), [
    { path: '/watch/first', query: { downloadId: '7', playlistId: 'playlist' } },
    { path: '/watch/second', query: { downloadId: '7', playlistId: 'playlist' } },
  ])
  assert.deepEqual(downloadQueueVideos({ id: 8 }), [])
  assert.deepEqual(downloadQueueVideos({ files: [{ videoId: 'missing', available: false }] }), [])
})
