import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { uid } from '@seald-io/nedb/lib/customUtils.js'
import { hasReachedWatchedThreshold } from '../../src/history.js'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'
import { mergeBackupWatchStatsAdjustment, mergeBackupWatchStatsRecord, validateBackupWatchStats } from '../../src/renderer/helpers/unifiedBackup.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const classSource = source.slice(source.indexOf('class WatchStats {'), source.indexOf('\nclass ', source.indexOf('class WatchStats {') + 1))

const backends = {
  NeDB: () => new Datastore({ inMemoryOnly: true }),
  SQLite: () => createDesktopDatastore(':memory:'),
}

function fixture(t, createDatastore) {
  const db = { watchStats: createDatastore(), history: createDatastore() }
  t.after(() => Object.values(db).forEach(store => store.driver?.close()))
  const WatchStats = vm.runInNewContext(`${classSource}\nWatchStats`, {
    db, uid, hasReachedWatchedThreshold, mergeBackupWatchStatsAdjustment, mergeBackupWatchStatsRecord, validateBackupWatchStats,
  })
  return { db, WatchStats }
}

for (const [name, createDatastore] of Object.entries(backends)) {
  test(`${name}: restoring watch statistics merges every day and the adjustment in one write`, async t => {
    const { db, WatchStats } = fixture(t, createDatastore)
    const { _id: storedId } = await db.watchStats.insertAsync({ date: '2026-01-01', seconds: 10 })
    await db.watchStats.insertAsync({ date: '2026-01-02', seconds: 50 })
    const replaceMany = db.watchStats.replaceManyAsync && t.mock.method(db.watchStats, 'replaceManyAsync')

    await WatchStats.mergeBackup({
      records: [
        // An imported id must not replace another stored document.
        { _id: storedId, date: '2026-01-02', seconds: 20 },
        { _id: 'imported', date: '2026-01-01', seconds: 30, historyEstimateApplied: true },
        { date: '2026-01-03', seconds: 40 },
      ],
      adjustment: { defaultSpeed: 2 },
    })

    if (replaceMany) assert.equal(replaceMany.mock.callCount(), 1)
    const stored = await WatchStats.find()
    assert.deepEqual(stored.map(({ date, seconds }) => [date, seconds]), [['2026-01-01', 30], ['2026-01-02', 50], ['2026-01-03', 40]])
    assert.equal(stored[0]._id, storedId)
    assert.equal(new Set(stored.map(record => record._id)).size, 3)
    assert.deepEqual(await WatchStats.getHistoricalAdjustment(), { defaultSpeed: 2 })
  })

  test(`${name}: adjusting the historical playback speed rewrites the estimated days in one write`, async t => {
    const { db, WatchStats } = fixture(t, createDatastore)
    await db.watchStats.insertAsync([
      { date: '2026-01-01', seconds: 130, historyEstimateApplied: true, historyEstimateSeconds: 100, historyAdjustedSeconds: 100, historyEstimateByChannel: { a: 100 } },
      { date: '2026-01-02', seconds: 15 },
      { _id: WatchStats.migrationId, completedAt: 1, hadEstimates: true, adjustment: null },
    ])
    const replaceMany = db.watchStats.replaceManyAsync && t.mock.method(db.watchStats, 'replaceManyAsync')

    const result = await WatchStats.adjustHistoricalWatchTime(2, { a: 4 })

    if (replaceMany) assert.equal(replaceMany.mock.callCount(), 1)
    // 30 recorded seconds stay, the 100 estimated ones watched at 4x count as 25.
    assert.deepEqual(result.records.map(({ date, seconds }) => [date, seconds]), [['2026-01-01', 55], ['2026-01-02', 15]])
    assert.equal((await WatchStats.getHistoricalAdjustment()).defaultSpeed, 2)
  })
}

test('resetting watch statistics removes every day', async t => {
  const { db, WatchStats } = fixture(t, backends.SQLite)
  await db.watchStats.insertAsync({ date: '2026-01-01', seconds: 10 })
  await WatchStats.deleteAll()
  assert.deepEqual(await WatchStats.find(), [])
})
