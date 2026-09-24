import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'

import { classifyTakeoutEntry, forEachSelectedTakeoutZipEntry, isSupportedTakeoutEntry, listYouTubeTakeoutZipEntries, parseTakeoutPlaylistCsv } from '../../src/renderer/helpers/youtube-takeout-zip.js'

test('detects supported Takeout entries under the archive root', () => {
  const root = 'takeout-001/Takeout/YouTube and YouTube Music'
  assert.equal(classifyTakeoutEntry(`${root}/subscriptions/subscriptions.csv`), 'subscriptions')
  assert.equal(classifyTakeoutEntry(`${root}/history/watch-history.json`), 'history')
  assert.equal(classifyTakeoutEntry(`${root}/history/search-history.json`), 'searchHistory')
  assert.equal(classifyTakeoutEntry(`${root}/playlists/My list.csv`), 'playlists')
  assert.equal(classifyTakeoutEntry(`${root}/videos/my-video.mp4`), null)
  assert.equal(classifyTakeoutEntry(`${root}/playlists/playlists.csv`), null)
})

test('lists supported entries and reads only selected archive content', async () => {
  const root = 'Takeout/YouTube and YouTube Music'
  const archive = zipSync({
    [`${root}/subscriptions/subscriptions.csv`]: strToU8('Channel Id,Channel Url,Channel Title\nUC123,https://youtube.com/channel/UC123,Example'),
    [`${root}/history/watch-history.json`]: strToU8('[]'),
    [`${root}/playlists/Favorites.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00'),
    [`${root}/videos/movie.mp4`]: new Uint8Array(100000),
  })
  const file = new Blob([archive])
  const listed = await listYouTubeTakeoutZipEntries(file)
  assert.deepEqual(listed.map(entry => entry.type).sort(), ['history', 'playlists', 'subscriptions'])
  assert.equal(listed.every(entry => !Object.hasOwn(entry, 'content')), true)
  const entries = []
  await forEachSelectedTakeoutZipEntry(file, new Set(['history']), entry => entries.push(entry))
  assert.deepEqual(entries.map(entry => entry.type), ['history'])
  assert.equal(entries[0].content, '[]')
  assert.equal(isSupportedTakeoutEntry(entries[0]), true)
  assert.equal(isSupportedTakeoutEntry({ type: 'history', path: 'history/watch-history.json', content: '<html />' }), false)
})

test('rejects oversized selected entries before inflation', async () => {
  const archive = zipSync({ 'Takeout/YouTube/history/watch-history.json': strToU8('[]') })
  new DataView(archive.buffer).setUint32(22, 256 * 1024 * 1024 + 1, true)
  const file = new Blob([archive])
  assert.equal((await listYouTubeTakeoutZipEntries(file)).length, 1)
  await assert.rejects(
    forEachSelectedTakeoutZipEntry(file, new Set(['history']), () => {}),
    /Takeout entry is too large/
  )
})

test('parses Takeout playlist CSV and rejects other CSV files', () => {
  assert.deepEqual(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n', 'My list.csv'), {
    playlistName: 'My list',
    videos: [{ videoId: 'abcdefghijk', title: 'abcdefghijk', lengthSeconds: 0, timeAdded: Date.parse('2025-01-01T00:00:00+00:00') }],
  })
  assert.equal(parseTakeoutPlaylistCsv('wrong header\n', 'My list.csv'), null)
  assert.equal(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\ninvalid row', 'My list.csv'), null)
  const quotedPlaylist = parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\n"abcdefghijk","2025-01-01T00:00:00+00:00"', 'My list.csv')
  assert.deepEqual(quotedPlaylist.videos.map(video => video.videoId), ['abcdefghijk'])
  assert.notEqual(parseTakeoutPlaylistCsv('Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
  assert.notEqual(parseTakeoutPlaylistCsv('影片 ID,播放清單影片的建立時間戳記\nabcdefghijk,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
  assert.equal(parseTakeoutPlaylistCsv('Video,Timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
})
