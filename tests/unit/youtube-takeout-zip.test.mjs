import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'

import { classifyTakeoutEntry, isSupportedTakeoutEntry, parseTakeoutPlaylistCsv, readYouTubeTakeoutZip } from '../../src/renderer/helpers/youtube-takeout-zip.js'

test('detects supported Takeout entries under the archive root', () => {
  const root = 'takeout-001/Takeout/YouTube and YouTube Music'
  assert.equal(classifyTakeoutEntry(`${root}/subscriptions/subscriptions.csv`), 'subscriptions')
  assert.equal(classifyTakeoutEntry(`${root}/history/watch-history.json`), 'history')
  assert.equal(classifyTakeoutEntry(`${root}/history/search-history.json`), 'searchHistory')
  assert.equal(classifyTakeoutEntry(`${root}/playlists/My list.csv`), 'playlists')
  assert.equal(classifyTakeoutEntry(`${root}/videos/my-video.mp4`), null)
  assert.equal(classifyTakeoutEntry(`${root}/playlists/playlists.csv`), null)
})

test('reads supported entries and skips unrelated archive content', async () => {
  const root = 'Takeout/YouTube and YouTube Music'
  const archive = zipSync({
    [`${root}/subscriptions/subscriptions.csv`]: strToU8('Channel Id,Channel Url,Channel Title\nUC123,https://youtube.com/channel/UC123,Example'),
    [`${root}/history/watch-history.json`]: strToU8('[]'),
    [`${root}/playlists/Favorites.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00'),
    [`${root}/videos/movie.mp4`]: new Uint8Array(100000),
  })
  const entries = await readYouTubeTakeoutZip(new Blob([archive]))
  assert.deepEqual(entries.map(entry => entry.type).sort(), ['history', 'playlists', 'subscriptions'])
  assert.equal(entries.find(entry => entry.type === 'history').content, '[]')
  assert.equal(entries.every(isSupportedTakeoutEntry), true)
  assert.equal(isSupportedTakeoutEntry({ type: 'history', path: 'history/watch-history.json', content: '<html />' }), false)
})

test('parses Takeout playlist CSV and rejects other CSV files', () => {
  assert.deepEqual(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n', 'My list.csv'), {
    playlistName: 'My list',
    videos: [{ videoId: 'abcdefghijk', title: 'abcdefghijk', lengthSeconds: 0, timeAdded: Date.parse('2025-01-01T00:00:00+00:00') }],
  })
  assert.equal(parseTakeoutPlaylistCsv('wrong header\n', 'My list.csv'), null)
  assert.equal(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\ninvalid row', 'My list.csv'), null)
  assert.deepEqual(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\n"abcdefghijk","2025-01-01T00:00:00+00:00"', 'My list.csv')?.videos.map(video => video.videoId), ['abcdefghijk'])
})
