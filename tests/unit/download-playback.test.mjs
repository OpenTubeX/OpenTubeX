import assert from 'node:assert/strict'
import test from 'node:test'

import { downloadQueueVideos, isDownloadPlaybackSupported, playDownloadedFile, refreshDownloadRecords } from '../../src/renderer/helpers/downloadPlayback.js'

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

test('checks platform eligibility before exposing external downloads', t => {
  const previous = { capacitor: process.env.IS_CAPACITOR, ios: process.env.IS_IOS }
  t.after(() => {
    for (const [key, value] of [['IS_CAPACITOR', previous.capacitor], ['IS_IOS', previous.ios]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const download = { status: 'completed', mode: 'video', retryPayload: { externalUrl: 'https://vimeo.com/123' } }
  assert.equal(isDownloadPlaybackSupported(download), false)
  process.env.IS_CAPACITOR = 'true'
  assert.equal(isDownloadPlaybackSupported(download), false)
  process.env.IS_IOS = 'true'
  assert.equal(Boolean(isDownloadPlaybackSupported(download)), true)
  assert.equal(isDownloadPlaybackSupported({ ...download, status: 'failed' }), false)
})

test('refreshes selected file availability and preserves its current playlist route', async () => {
  const selected = { videoId: 'second', path: '/downloads/second.webm', available: true }
  const download = { id: 42, status: 'completed', mode: 'video', playlistKey: 'current-playlist', files: [
    { videoId: 'first', path: '/downloads/first.webm', available: true },
    { ...selected, isShort: false },
  ] }
  const commits = []
  const navigations = []
  await playDownloadedFile(42, selected, {
    refreshDownloads: () => refreshDownloadRecords({ ytDlpListDownloads: async () => [download] }, {
      commit: (type, record) => commits.push([type, record.id]),
    }),
    navigate: route => navigations.push(route),
    playNative: async () => { throw new Error('Desktop playback must use the watch route') },
    fileNotFound: () => { throw new Error('The selected file exists') },
  })
  assert.deepEqual(commits, [['upsertYtDlpDownload', 42]])
  assert.deepEqual(navigations, [{ path: '/watch/second', query: { downloadId: '42', playlistId: 'current-playlist', playlistType: 'user', short: 'false' } }])
})

test('rejects deleted or moved files without navigating to another file', async () => {
  for (const files of [[], [{ videoId: 'saved', path: '/old.mp4', available: false }], [{ videoId: 'saved', path: '/new.mp4', available: true }]]) {
    let missing = 0
    await playDownloadedFile(42, { videoId: 'saved', path: '/old.mp4', available: true }, {
      refreshDownloads: async () => [{ id: 42, status: 'completed', mode: 'video', files }],
      navigate: () => { throw new Error('Missing files must not navigate') },
      playNative: async () => { throw new Error('Missing files must not play') },
      fileNotFound: () => { missing++ },
    })
    assert.equal(missing, 1)
  }
})

test('iOS opens the selected external file through the native player and reports native failures', async t => {
  const previous = process.env.IS_IOS
  process.env.IS_IOS = 'true'
  t.after(() => {
    if (previous === undefined) delete process.env.IS_IOS
    else process.env.IS_IOS = previous
  })
  const selected = { videoId: 'external', path: '/native.mp4', extension: 'mp4', available: true }
  const nativeCalls = []
  let missing = 0
  for (const success of [true, false]) {
    await playDownloadedFile(42, selected, {
      refreshDownloads: async () => [{ id: 42, status: 'completed', mode: 'video', retryPayload: { externalUrl: 'https://vimeo.com/123' }, files: [selected] }],
      playNative: async (id, path) => { nativeCalls.push([id, path]); return success },
      navigate: () => { throw new Error('iOS must not open a YouTube watch route') },
      fileNotFound: () => { missing++ },
    })
  }
  assert.deepEqual(nativeCalls, [[42, '/native.mp4'], [42, '/native.mp4']])
  assert.equal(missing, 1)
})
