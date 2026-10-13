import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { needsPlaylistRepair, playlistRepairPatch, playlistRepairRecords } from '../../src/playlistRepair.js'
import { repairHistory } from '../../src/historyRepair.js'

const video = { videoId: 'abcdefghijk', title: 'Imported title', author: '', authorId: '', published: 0, lengthSeconds: 0, playlistItemId: 'first', timeAdded: 10 }
const metadata = { videoId: video.videoId, title: 'Fetched title', author: 'Channel', authorId: 'UCchannel', published: 100, lengthSeconds: 120, isLive: false, isUpcoming: false, description: 'Details' }
const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
async function fixture() {
  const db = { playlists: new Datastore({ inMemoryOnly: true }) }
  const Playlists = vm.runInNewContext(source.slice(source.indexOf('class Playlists {'), source.indexOf('\nclass SearchHistory {')) + '\nPlaylists', { db, playlistRepairPatch, console, PlaylistVideoAddResult: {} })
  await db.playlists.insertAsync({ _id: 'selected', playlistName: 'Takeout', description: 'Keep', protected: true, lastPlayedAt: 50, videos: [video, { ...video, playlistItemId: 'duplicate', author: 'Existing channel' }] })
  await db.playlists.insertAsync({ _id: 'unselected', videos: [video] })
  return { db, Playlists }
}

test('selects incomplete YouTube videos once across playlists and excludes other sources', () => {
  assert.deepEqual(playlistRepairRecords([{ videos: [video, { ...video, playlistItemId: 'duplicate' }, { videoId: 'twitch:123' }, { ...video, isStation: true }] }, { videos: [video] }]), [video])
})

test('fills public metadata without changing existing titles or adding history-only fields', () => {
  const patch = playlistRepairPatch(video, metadata)
  assert.equal(patch.title, undefined)
  assert.equal(patch.authorId, 'UCchannel')
  assert.equal(patch.description, undefined)
  assert.equal(patch.liveNow, undefined)
  assert.equal(patch.playlistItemId, undefined)
})

test('repairs every occurrence only in selected playlists and preserves playlist context', async () => {
  const { db, Playlists } = await fixture()
  const unselected = await db.playlists.findOneAsync({ _id: 'unselected' })
  const result = await Playlists.repairMetadata({ playlistIds: ['selected'], metadata: [metadata] })
  assert.equal(result.repaired, 1)
  assert.equal(result.failed, 0)
  const saved = await db.playlists.findOneAsync({ _id: 'selected' })
  assert.equal(saved.playlistName, 'Takeout')
  assert.equal(saved.description, 'Keep')
  assert.equal(saved.protected, true)
  assert.equal(saved.lastPlayedAt, 50)
  assert.deepEqual(saved.videos.map(v => v.playlistItemId), ['first', 'duplicate'])
  assert.deepEqual(saved.videos.map(v => v.author), ['Channel', 'Existing channel'])
  assert.ok(saved.videos.every(v => v.timeAdded === 10 && v.authorId === 'UCchannel' && v.title === 'Imported title'))
  assert.deepEqual(await db.playlists.findOneAsync({ _id: 'unselected' }), unselected)
})

test('re-reads after concurrent removal and does not resurrect a removed entry', async () => {
  const { db, Playlists } = await fixture()
  const update = db.playlists.updateAsync.bind(db.playlists)
  let intercepted = false
  db.playlists.updateAsync = async (query, changes, options) => {
    if (!intercepted && query.$where) {
      intercepted = true
      await update({ _id: 'selected' }, { $pull: { videos: { playlistItemId: 'first' } } })
      await update({ _id: 'selected' }, { $set: { playlistName: 'Renamed' } })
    }
    return update(query, changes, options)
  }
  await Playlists.repairMetadata({ playlistIds: ['selected'], metadata: [metadata] })
  const saved = await db.playlists.findOneAsync({ _id: 'selected' })
  assert.equal(saved.playlistName, 'Renamed')
  assert.equal(saved.videos.length, 1)
  assert.equal(saved.videos[0].playlistItemId, 'duplicate')
  assert.equal(saved.videos[0].authorId, 'UCchannel')
})

test('does not recreate a playlist deleted during repair', async () => {
  const { db, Playlists } = await fixture()
  await db.playlists.removeAsync({ _id: 'selected' })
  const result = await Playlists.repairMetadata({ playlistIds: ['selected'], metadata: [metadata] })
  assert.equal(result.repaired, 0)
  assert.equal(await db.playlists.findOneAsync({ _id: 'selected' }), null)
})

test('shared repair runner sends full metadata for different missing fields in duplicate entries', async () => {
  const { db, Playlists } = await fixture()
  let requests = 0
  const getPlaylists = () => db.playlists.findAsync({ _id: 'selected' })
  const playlists = await getPlaylists()
  const result = await repairHistory({
    records: playlistRepairRecords(playlists), getRecord: () => video,
    fetchMetadata: async () => { requests++; return metadata },
    createPatch: (record, info) => ({ ...info, videoId: record.videoId }),
    saveMetadata: info => Playlists.repairMetadata({ playlistIds: ['selected'], metadata: info }),
    signal: new AbortController().signal, onProgress: () => {}, wait: async () => {},
  })
  assert.equal(requests, 1)
  assert.equal(result.repaired, 1)
  assert.ok((await getPlaylists())[0].videos.every(v => v.authorId === metadata.authorId))
})

test('replaces Takeout video-ID title placeholders even when other metadata is complete', async () => {
  const imported = { ...metadata, title: metadata.videoId }
  assert.equal(needsPlaylistRepair(imported), true)
  assert.equal(playlistRepairPatch(imported, metadata).title, metadata.title)
  let saved
  await repairHistory({
    records: playlistRepairRecords([{ videos: [imported] }]),
    needsRepair: needsPlaylistRepair, getRecord: () => imported,
    createPatch: playlistRepairPatch, fetchMetadata: async () => metadata,
    saveMetadata: async updates => { saved = updates; return { repaired: 1, failed: 0 } },
    signal: new AbortController().signal, onProgress: () => {},
  })
  assert.equal(saved[0].title, metadata.title)
})
