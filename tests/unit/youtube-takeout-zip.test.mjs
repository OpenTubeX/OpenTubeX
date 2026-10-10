import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import Datastore from '@seald-io/nedb'

import { classifyTakeoutEntry, forEachSelectedTakeoutZipEntry, isSupportedTakeoutEntry, listYouTubeTakeoutZipEntries, parseTakeoutPlaylistCsv } from '../../src/renderer/helpers/youtube-takeout-zip.js'
import { importTakeoutPlaylist } from '../../src/renderer/helpers/takeout-playlist-import.js'
import { processToBeAddedPlaylistVideo } from '../../src/renderer/helpers/playlists.js'

test('portable Takeout imports retain duplicate members and unrelated fields across repeated merges', async () => {
  const playlists = new Datastore({ inMemoryOnly: true })
  const timeAdded = Date.parse('2025-01-01T00:00:00Z')
  const saved = [
    { videoId: 'abcdefghijk', timeAdded, playlistItemId: 'first', unknown: { keep: true } },
    { videoId: 'abcdefghijk', timeAdded, playlistItemId: 'second' },
    { videoId: 'saved-video', timeAdded: 1, playlistItemId: 'off-page' },
  ]
  await playlists.insertAsync({ _id: 'saved', playlistName: 'Shared name', videos: saved, protected: true, future: { keep: true } })
  const storage = {
    find: () => playlists.findAsync({}),
    create: playlist => {
      for (const video of playlist.videos) processToBeAddedPlaylistVideo(video)
      return playlists.insertAsync(playlist)
    },
    update: playlist => playlists.updateAsync({ _id: playlist._id }, { $set: playlist }),
  }
  const entry = { path: 'Takeout/YouTube/playlists/Shared name.csv', content: 'Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z\nmnopqrstuvw,2025-01-02T00:00:00Z\n' }
  await importTakeoutPlaylist(entry, 'Shared name', storage)
  const merged = await playlists.findOneAsync({ _id: 'saved' })
  assert.deepEqual(merged.videos.slice(0, saved.length), saved)
  assert.equal(merged.videos.length, saved.length + 1)
  assert.equal(merged.protected, true)
  assert.deepEqual(merged.future, { keep: true })
  assert.equal(merged.videos.at(-1).type, 'video')
  assert.equal(typeof merged.videos.at(-1).playlistItemId, 'string')
  await importTakeoutPlaylist(entry, 'Shared name', storage)
  assert.deepEqual(await playlists.findOneAsync({ _id: 'saved' }), merged)
  await importTakeoutPlaylist(entry, 'New imported playlist', storage)
  const created = await playlists.findOneAsync({ playlistName: 'New imported playlist' })
  assert.equal(created.videos.length, 2)
  await importTakeoutPlaylist(entry, 'New imported playlist', storage)
  assert.deepEqual(await playlists.findOneAsync({ _id: created._id }), created)
})

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
