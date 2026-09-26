import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'

import { BACKUP_SECTIONS, createUnifiedBackup, mergeBackupPlaylist, mergeBackupProfile, mergeBackupWatchStatsAdjustment, readUnifiedBackup } from '../../src/renderer/helpers/unifiedBackup.js'

const data = {
  settings: { theme: 'dark' },
  profiles: [{ _id: 'main', name: 'Main', subscriptions: [] }],
  playlists: [{ _id: 'favorites', playlistName: 'Favorites', videos: [] }],
  history: [{ videoId: 'abcdefghijk', timeWatched: 1 }],
  searchHistory: [{ _id: 'search', query: 'music' }],
  watchStats: {
    records: [{ date: '2026-09-26', seconds: 42, historyEstimateApplied: true }],
    adjustment: { defaultSpeed: 1.5 },
  },
}

test('round trips every backup section in a ZIP archive', async () => {
  const backup = createUnifiedBackup(data)
  const result = await readUnifiedBackup(backup)
  assert.equal(result.manifest.format, 'opentubex-backup')
  assert.equal(result.manifest.version, 1)
  assert.deepEqual(result.data, data)
  assert.deepEqual(Object.keys(result.data), BACKUP_SECTIONS)
})

test('rejects an incomplete archive before restoring data', async () => {
  const backup = new Blob([zipSync({ 'manifest.json': strToU8('{"format":"opentubex-backup","version":1}') })])
  await assert.rejects(readUnifiedBackup(backup), /missing or unexpected files/)
})

test('rejects malformed records before restoring data', async () => {
  const malformed = { ...data, playlists: [{ _id: 'broken', videos: [] }] }
  await assert.rejects(readUnifiedBackup(createUnifiedBackup(malformed)), /Invalid backup playlists/)
})

test('rejects backup versions the importer cannot read', async () => {
  const files = Object.fromEntries(BACKUP_SECTIONS.map(section => [`${section}.json`, strToU8(JSON.stringify(data[section]))]))
  files['manifest.json'] = strToU8('{"format":"opentubex-backup","version":2}')
  await assert.rejects(readUnifiedBackup(new Blob([zipSync(files)])), /Unsupported backup version/)
})

test('merges subscriptions and playlist videos without dropping local entries', () => {
  const currentProfile = { _id: 'main', name: 'Local', subscriptions: [{ id: 'local' }] }
  const incomingProfile = { _id: 'main', name: 'Imported', subscriptions: [{ id: 'imported' }] }
  assert.deepEqual(mergeBackupProfile(currentProfile, incomingProfile).subscriptions.map(channel => channel.id), ['local', 'imported'])

  const currentPlaylist = { _id: 'favorites', playlistName: 'Local', videos: [{ videoId: 'local', timeAdded: 1 }] }
  const incomingPlaylist = { _id: 'favorites', playlistName: 'Imported', videos: [{ videoId: 'imported', timeAdded: 2 }] }
  const merged = mergeBackupPlaylist(currentPlaylist, incomingPlaylist)
  assert.deepEqual(merged.videos.map(video => video.videoId), ['local', 'imported'])
  assert.deepEqual(mergeBackupPlaylist(merged, incomingPlaylist).videos, merged.videos)
})

test('clears a conflicting adjustment when both sets contain watch-time estimates', () => {
  const estimated = [{ date: '2026-09-26', seconds: 42, historyEstimateApplied: true }]
  assert.equal(mergeBackupWatchStatsAdjustment(estimated, { defaultSpeed: 2 }, estimated, null), null)
  assert.deepEqual(mergeBackupWatchStatsAdjustment(estimated, { defaultSpeed: 2 }, estimated, { defaultSpeed: 2 }), { defaultSpeed: 2 })
  assert.deepEqual(mergeBackupWatchStatsAdjustment(estimated, { defaultSpeed: 2 }, [], null), { defaultSpeed: 2 })
})
