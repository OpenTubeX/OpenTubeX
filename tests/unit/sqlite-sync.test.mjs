import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { LibrarySync } from '../../src/datastores/sqlite/sync.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { LibraryJobs } from '../../src/main/libraryJobs.js'
import { videoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'

function fixture(t) {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
  t.after(() => database.close())
  const engine = new LibraryEngine(database)
  return { engine, sync: new LibrarySync(engine) }
}
const video = i => ({ videoId: String(i).padStart(11, '0'), authorId: 'channel', author: 'Author', title: `Video ${i}`, lengthSeconds: 100, timeWatched: i + 1, watchProgress: 5, isWatched: false })

test('playlist sync preserves every duplicate, stable identity, order, unknown data and protected state', async t => {
  const { engine, sync } = fixture(t)
  const videos = [{ ...video(1), playlistItemId: 'same', future: { keep: true } }, { ...video(1), playlistItemId: 'same', title: 'Second copy' }, { videoId: 'incomplete', unknown: true }]
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Protected', protected: true, createdAt: 0, videos })
  const before = engine.playlistPage({ id: 'p' }).records.map(record => record._libraryMemberId)
  const job = sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Renamed', description: '' } })
  sync.chunk({ ...job, section: 'remote', records: [videoToRemote(video(1)), videoToRemote(video(2))] })
  const plan = await sync.plan(job)
  assert.equal(plan.counts.playlistMembers, 4)
  assert.equal(await sync.apply(job, {}), true)
  const stored = await engine.playlistSnapshot({ id: 'p' })
  assert.deepEqual(stored.videos.slice(0, 3), videos)
  assert.equal(stored.videos[3].videoId, video(2).videoId)
  assert.equal(stored.protected, true)
  assert.equal(stored.createdAt, 0)
  assert.deepEqual(engine.playlistPage({ id: 'p' }).records.slice(0, 3).map(record => record._libraryMemberId), before)
  sync.cancel(job)
})

test('sync rejects a stale plan after a second window changes the durable playlist', async t => {
  const { engine, sync } = fixture(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Before', videos: [video(1)] })
  const job = sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Remote', description: '' } })
  sync.chunk({ ...job, section: 'remote', records: [videoToRemote(video(1))] })
  await sync.plan(job)
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $push: { videos: video(2) } })
  assert.equal(sync.page({ ...job, section: 'playlistIds' }).current, false)
  assert.equal(await sync.apply(job, {}), false)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos.map(record => record.videoId), [video(1).videoId, video(2).videoId])
  sync.cancel(job)
})

test('history sync pages stay bounded and applying a failed batch rolls back all earlier batches', async t => {
  const { engine, sync } = fixture(t)
  await engine.collections.history.insertAsync(Array.from({ length: 350 }, (_, i) => ({ ...video(i), _id: `h${i}` })))
  const job = sync.start({ options: {} })
  const plan = await sync.plan(job)
  assert.equal(plan.counts.historyToUpload, 350)
  assert.equal(sync.page({ ...job, section: 'historyToUpload' }).records.length, 100)
  assert.equal(sync.page({ ...job, section: 'historyToUpload', offset: 300 }).records.length, 50)
  await engine.collections.history.updateAsync({ videoId: video(0).videoId }, { $set: { title: 'Concurrent' } })
  assert.equal(await sync.apply(job, { history: {} }), false)
  sync.cancel(job)

  // Remote-only entries force two insertion batches. A failure in the second
  // must also roll back the successfully processed first batch.
  const incoming = sync.start({ options: {} })
  for (let offset = 0; offset < 300; offset += 250) sync.chunk({ ...incoming, section: 'remote', records: Array.from({ length: Math.min(250, 300 - offset) }, (_, i) => ({ video: videoToRemote(video(1000 + offset + i)), metadata: { added_date: 1, watched_state: 'completed', position_millis: 90_000 } })) })
  await sync.plan(incoming)
  let calls = 0
  await assert.rejects(sync.apply(incoming, { history: { applySyncChanges: async ({ insertions }) => {
    if (!insertions.length) return
    if (++calls === 2) throw new Error('disk full')
    await engine.collections.history.insertAsync(insertions)
  } } }), /disk full/)
  assert.equal(await engine.collections.history.countAsync({}), 350)
  assert.equal((await engine.collections.history.findOneAsync({ videoId: video(0).videoId })).title, 'Concurrent')
  sync.cancel(incoming)
})

test('sync retains the existing mass-deletion guard and leaves the local data unchanged', async t => {
  const { engine, sync } = fixture(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', videos: [video(1)] })
  const job = sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Playlist' } })
  sync.chunk({ ...job, section: 'previous', records: [video(1).videoId] })
  await assert.rejects(sync.plan(job), error => error.name === 'SyncServerDataLossError')
  assert.equal(engine.playlistStatistics({ id: 'p' }).total, 1)
  sync.cancel(job)
})

test('library job leases enforce window ownership and release snapshots on crashes, close and expiry', async () => {
  const canceled = []
  const jobs = new LibraryJobs(async (method, data) => { canceled.push([method, data.id]) }, 20)
  const first = new EventEmitter()
  const other = new EventEmitter()
  jobs.track(first, 'exportStart', 'a')
  assert.throws(() => jobs.access(other, 'exportNext', 'a'), /does not belong/)
  assert.throws(() => jobs.access(other, 'exportCancel', 'a'), /does not belong/)
  assert.throws(() => jobs.access(first, 'importChunk', 'a'), /does not belong/)
  assert.throws(() => jobs.access(first, 'exportNext', 'missing'), /does not belong/)
  assert.throws(() => jobs.access(first, 'importApply', 'missing'), /does not belong/)
  first.emit('render-process-gone')
  assert.deepEqual(canceled, [['exportCancel', 'a']])
  jobs.track(first, 'importStart', 'b')
  first.emit('destroyed')
  assert.deepEqual(canceled.at(-1), ['importCancel', 'b'])
  jobs.track(other, 'syncHistoryStart', 'c')
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.deepEqual(canceled.at(-1), ['syncHistoryCancel', 'c'])
  assert.equal(jobs.jobs.size, 0)
  assert.equal(jobs.access(first, 'exportCancel', 'a'), false)
})
