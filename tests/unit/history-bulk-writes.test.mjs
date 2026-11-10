import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { migrateLegacyHistoryRecord } from '../../src/history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'
import { migrateStoredSettings } from '../../src/datastores/settingsMigrations.js'
import { createIdQuery } from '../../src/datastores/idQuery.js'
import { SqliteDatastore } from '../../src/datastores/sqlite.js'
import { createNodeSqliteDriver } from '../../src/datastores/sqliteNode.js'
import { mergeBackupHistoryRecord } from '../../src/renderer/helpers/unifiedBackup.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const COUNT = 1000

async function fixture(t) {
  const work = { calls: 0, commits: 0 }
  const store = options => {
    const driver = createNodeSqliteDriver(':memory:')
    t.after(() => driver.close())
    return new SqliteDatastore({
      ...options,
      driver: { ...driver, execute (statements, transaction) { work.calls++; if (transaction) work.commits++; return driver.execute(statements, transaction) } },
    })
  }
  const db = { settings: store(), history: store({ indexes: ['videoId'] }) }
  await Promise.all([db.settings.loadDatabaseAsync(), db.history.loadDatabaseAsync()])
  const { History } = vm.runInNewContext(source.slice(source.indexOf('class Settings {'), source.indexOf('\nclass WatchStats {')) + '\n({History})', {
    db,
    ...seenVideos,
    migrateLegacyHistoryRecord,
    migrateStoredSettings,
    createIdQuery,
    mergeBackupHistoryRecord,
    recommendations: { remove: async () => {} },
    HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated',
    console,
  })
  const measure = async operation => {
    work.calls = 0
    work.commits = 0
    const result = await operation()
    return { result, calls: work.calls, commits: work.commits }
  }
  return { db, History, measure }
}

const record = index => ({ videoId: `video-${index}`, title: `Video ${index}`, lengthSeconds: 100, watchProgress: 0, timeWatched: index, type: 'video' })

test('bulk history writes commit in batches instead of once per record', async (t) => {
  const { db, History, measure } = await fixture(t)
  await db.history.insertAsync(Array.from({ length: COUNT }, (_, index) => record(index)))

  const migration = await measure(() => History.migrateWatchedStatus())
  assert.equal(migration.commits, 10 + 1, 'ten batches and the migration marker')
  assert.equal((await db.history.findAsync({ isWatched: { $exists: false } })).length, 0)

  // Marking videos as watched updates stored records and inserts new ones
  const watched = await measure(() => History.updateSubscriptionState({
    records: Array.from({ length: COUNT }, (_, index) => ({ ...record(index + COUNT / 2), isWatched: true })),
  }))
  assert.equal(watched.result.records.length, COUNT)
  assert.ok(watched.calls <= 25, `${watched.calls} driver calls`)
  assert.equal(watched.commits, 10)
  assert.equal(await db.history.countAsync({}), COUNT * 1.5)

  const metadata = await measure(() => History.updateSubscriptionState({
    metadata: Array.from({ length: COUNT }, (_, index) => ({ videoId: `video-${index}`, title: `Renamed ${index}`, pendingDurationRepair: true })),
  }))
  assert.deepEqual([metadata.result.records.length, metadata.result.failedCount, metadata.calls, metadata.commits], [COUNT, 0, 20, 10])

  // Only repairs that still match are cleared
  await db.history.updateAsync({ videoId: 'video-1' }, { $set: { lengthSeconds: 200 } })
  const repairs = await measure(() => History.updateSubscriptionState({
    acknowledgedRepairs: Array.from({ length: COUNT }, (_, index) => ({ videoId: `video-${index}`, lengthSeconds: 100, pendingDurationRepair: true })),
  }))
  assert.deepEqual([repairs.result.records.length, repairs.result.failedCount, repairs.calls, repairs.commits], [COUNT - 1, 0, 20, 10])
  assert.equal((await db.history.findOneAsync({ videoId: 'video-1' })).pendingDurationRepair, true)
  assert.equal((await db.history.findOneAsync({ videoId: 'video-2' })).pendingDurationRepair, undefined)

  const sync = await measure(() => History.applySyncChanges({
    insertions: [], deletions: [], updates: Array.from({ length: COUNT }, (_, index) => ({ ...record(index), title: `Synced ${index}` })),
  }))
  assert.deepEqual([sync.calls, sync.commits], [20, 10])
  assert.equal((await db.history.findOneAsync({ videoId: 'video-7' })).title, 'Synced 7')
  assert.equal(await db.history.countAsync({}), COUNT * 1.5)
})

test('a metadata repair that cannot be applied is counted without losing the others', async (t) => {
  const { db, History } = await fixture(t)
  await db.history.insertAsync([record(1), record(2)])
  const errors = []
  const original = console.error
  console.error = error => errors.push(error)
  t.after(() => { console.error = original })
  const result = await History.updateSubscriptionState({
    metadata: [{ videoId: 'video-1', title: { $invalid: true } }, { videoId: 'video-2', title: 'Renamed' }],
  })
  assert.equal(result.failedCount, 1)
  assert.equal(errors.length, 1)
  assert.deepEqual(Array.from(result.records, entry => entry.title), ['Renamed'])
  assert.equal((await db.history.findOneAsync({ videoId: 'video-1' })).title, 'Video 1')
})

test('restoring history merges into the saved records without dropping ones saved meanwhile', async (t) => {
  const { db, History } = await fixture(t)
  await db.history.insertAsync([record(1), record(2)])

  // Playback saves progress for a new video while the restore is queued
  const [, merged] = await Promise.all([
    History.updateWatchProgress('video-9', 42),
    History.mergeBackup([{ ...record(1), timeWatched: 0, title: 'Older title', watchProgress: 50 }, record(3)]),
  ])

  assert.deepEqual(Array.from(merged, entry => entry.videoId), ['video-1', 'video-3'])
  const saved = new Map((await db.history.findAsync({})).map(entry => [entry.videoId, entry]))
  assert.deepEqual([...saved.keys()].sort(), ['video-1', 'video-2', 'video-3', 'video-9'])
  assert.equal(saved.get('video-1').title, 'Video 1')
  assert.equal(saved.get('video-1').watchProgress, 50)
  assert.equal(saved.get('video-9').watchProgress, 42)
})
