import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import Datastore from '@seald-io/nedb'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'

const directory = await mkdtemp(join(tmpdir(), 'opentubex-storage-benchmark-'))
const sampleCount = 7
const sizes = process.argv.slice(2).map(Number)
if (!sizes.length) sizes.push(100000, 1000000)
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]
const output = { node: process.version, platform: process.platform, samples: sampleCount, datasets: [] }

function sqlite(name) {
  const database = new DatabaseSync(join(directory, name))
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA cache_size = -16384')
  database.exec(SCHEMA_SQL)
  return new LibraryEngine(database)
}

async function size(path) {
  try { return (await stat(path)).size } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }
}

try {
  const playlistPath = join(directory, 'playlists.db')
  const legacyPlaylist = new Datastore({ filename: playlistPath })
  await legacyPlaylist.loadDatabaseAsync()
  const playlistEngine = sqlite('playlists.sqlite')
  const videos = Array.from({ length: 20000 }, (_, index) => ({
    videoId: `video-${index}`,
    playlistItemId: `item-${index}`,
    title: `Practical troubleshooting techniques episode ${index}`,
    author: 'Example Channel',
    lengthSeconds: 300,
    timeAdded: index,
  }))
  const playlist = { _id: 'playlist', playlistName: 'Original', lastUpdatedAt: 1, videos }
  await legacyPlaylist.insertAsync(playlist)
  await playlistEngine.collections.playlists.insertAsync(playlist)
  playlistEngine.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const rename = { legacyMs: [], sqliteMs: [], legacyBytes: [], sqliteBytes: [] }
  for (let iteration = 0; iteration < sampleCount; iteration++) {
    const patch = { playlistName: `Renamed ${iteration}`, lastUpdatedAt: iteration + 2 }
    const legacyBefore = await size(playlistPath)
    let start = performance.now()
    await legacyPlaylist.updateAsync({ _id: 'playlist' }, { $set: patch })
    rename.legacyMs.push(performance.now() - start)
    rename.legacyBytes.push(await size(playlistPath) - legacyBefore)
    const walPath = join(directory, 'playlists.sqlite-wal')
    const sqliteBefore = await size(walPath)
    start = performance.now()
    await playlistEngine.collections.playlists.updateAsync({ _id: 'playlist' }, { $set: patch })
    rename.sqliteMs.push(performance.now() - start)
    rename.sqliteBytes.push(await size(walPath) - sqliteBefore)
  }
  assert.deepEqual((await playlistEngine.collections.playlists.findOneAsync({ _id: 'playlist' })).videos, videos)
  output.playlistRename = { size: videos.length, ...rename, medianLegacyMs: median(rename.legacyMs), medianSqliteMs: median(rename.sqliteMs) }
  playlistEngine.database.close()
  console.log('Playlist rename:', JSON.stringify(output.playlistRename))

  for (const count of sizes) {
    const legacy = new Datastore({ filename: join(directory, `history-${count}.db`) })
    await legacy.loadDatabaseAsync()
    const engine = sqlite(`history-${count}.sqlite`)
    for (let offset = 0; offset < count; offset += 1000) {
      const records = Array.from({ length: Math.min(1000, count - offset) }, (_, index) => {
        const value = offset + index
        return {
          _id: `record-${String(value).padStart(8, '0')}`,
          videoId: `video-${value}`,
          playlistItemId: `item-${value}`,
          title: `Practical troubleshooting techniques episode ${value}`,
          author: `Example Channel ${value % 100}`,
          authorId: `channel-${value % 100}`,
          type: 'video',
          lengthSeconds: 300,
          watchProgress: value % 300,
          isWatched: value % 2 === 0,
          timeWatched: 1600000000000 + value,
        }
      })
      await legacy.insertAsync(records)
      await engine.collections.history.insertAsync(records)
    }
    const measurements = { count, fullHistoryMs: [], pageMs: [], fullIpcBytes: 0, pageIpcBytes: 0 }
    for (let iteration = 0; iteration < sampleCount; iteration++) {
      let start = performance.now()
      const records = await legacy.findAsync({}).sort({ timeWatched: -1 })
      measurements.fullHistoryMs.push(performance.now() - start)
      measurements.fullIpcBytes = Buffer.byteLength(JSON.stringify(records))
      start = performance.now()
      const page = engine.historyPage({ limit: 50 })
      measurements.pageMs.push(performance.now() - start)
      measurements.pageIpcBytes = Buffer.byteLength(JSON.stringify(page))
      assert.deepEqual(page.records.map(record => record._id), records.slice(0, 50).map(record => record._id))
    }
    measurements.medianFullHistoryMs = median(measurements.fullHistoryMs)
    measurements.medianPageMs = median(measurements.pageMs)
    output.datasets.push(measurements)
    engine.database.close()
    console.log('History:', JSON.stringify(measurements))
  }
  console.log(JSON.stringify(output, null, 2))
} finally { await rm(directory, { recursive: true, force: true }) }
