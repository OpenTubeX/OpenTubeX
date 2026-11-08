import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { hasReachedWatchedThreshold, migrateLegacyHistoryRecord, newestUniqueHistoryRecords } from '../../src/history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'
import { migrateStoredSettings } from '../../src/datastores/settingsMigrations.js'
import { createIdQuery } from '../../src/datastores/idQuery.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

function fixture(recommendations = { remove: async () => {} }) {
  const db = {
    settings: new Datastore({ inMemoryOnly: true }),
    history: new Datastore({ inMemoryOnly: true }),
    watchStats: new Datastore({ inMemoryOnly: true }),
  }
  const handlers = vm.runInNewContext(
    source.slice(source.indexOf('class Settings {'), source.indexOf('\nclass Profiles {')) + '\n({ History, WatchStats })',
    {
      db,
      ...seenVideos,
      hasReachedWatchedThreshold,
      migrateLegacyHistoryRecord,
      newestUniqueHistoryRecords,
      migrateStoredSettings,
      createIdQuery,
      recommendations,
      HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated',
    }
  )
  return { db, ...handlers }
}

function failOnce(datastore, method) {
  const original = datastore[method].bind(datastore)
  let failed = false
  datastore[method] = (...args) => {
    if (failed) return original(...args)
    failed = true
    return Promise.reject(new Error('storage unavailable'))
  }
}

test('history reads recover after a failed watched status migration', async () => {
  const { db, History } = fixture()
  await db.history.insertAsync({ videoId: 'video', title: 'Video', watchProgress: 10, lengthSeconds: 100, timeWatched: 1 })
  failOnce(db.settings, 'findOneAsync')

  await assert.rejects(History.find(), /storage unavailable/)
  const records = await History.find()

  assert.deepEqual(records.map(record => [record.videoId, record.isWatched]), [['video', false]])
})

test('watch stats recover after a failed history migration', async () => {
  const { db, WatchStats } = fixture()
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  failOnce(db.watchStats, 'findOneAsync')

  await assert.rejects(WatchStats.migrateHistory(), /storage unavailable/)

  assert.equal(await WatchStats.migrateHistory(), false)
  assert.ok(await db.watchStats.findOneAsync({ _id: WatchStats.migrationId }))
})

test('deleting old history keeps a video watched again while the deletion runs', async () => {
  const removingRecommendations = Promise.withResolvers()
  const releaseRecommendations = Promise.withResolvers()
  const { db, History } = fixture({
    remove: async () => {
      removingRecommendations.resolve()
      await releaseRecommendations.promise
    },
  })
  await db.history.insertAsync({ videoId: 'video', title: 'Video', isWatched: true, watchProgress: 0, timeWatched: 1 })

  const deletion = History.deleteOlderThan(10)
  await removingRecommendations.promise
  const rewatch = History.upsert({ videoId: 'video', title: 'Video', isWatched: true, watchProgress: 0, timeWatched: 20 })
  // Let the rewatch save unless it waits for the deletion.
  await new Promise(resolve => setImmediate(resolve))
  releaseRecommendations.resolve()

  assert.deepEqual(await deletion, ['video'])
  await rewatch
  assert.deepEqual((await db.history.findAsync({ videoId: 'video' })).map(record => record.timeWatched), [20])
})
