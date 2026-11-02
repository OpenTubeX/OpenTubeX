import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { DBActions } from '../../src/constants.js'
import { migrateLegacyHistoryRecord, newestUniqueHistoryRecords } from '../../src/history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'
import { createIdQuery } from '../../src/datastores/idQuery.js'
import { migrateStoredSettings } from '../../src/datastores/settingsMigrations.js'
import { SqliteDatastore } from '../../src/datastores/sqlite.js'
import { createDesktopDatastore, createNodeSqliteDriver } from '../../src/datastores/sqliteNode.js'

function memory(t, options = {}) {
  const store = new SqliteDatastore({ driver: createNodeSqliteDriver(':memory:'), ...options })
  t.after(() => store.driver.close())
  return store
}

test('serialized reads return each stored document as its JSON text, without parsing in this process', async t => {
  const store = memory(t, { indexes: ['videoId'] })
  const docs = [
    { _id: 'b', videoId: 'b', title: 'Ünïcode "quoted" \u2028 line', timeWatched: 2, nested: { list: [1, null, 'x'] } },
    { _id: 'a', videoId: 'a', title: 'Plain', timeWatched: 1 },
  ]
  await store.insertAsync(docs)

  const rows = await store.findSerializedAsync()
  assert.ok(rows.every(row => typeof row === 'string'))
  assert.deepEqual(rows.map(row => JSON.parse(row)), await store.findAsync({}))
})

test('serialized reads find nothing after the datastore was dropped', async t => {
  const store = memory(t)
  await store.insertAsync({ _id: 'a' })
  await store.dropDatabaseAsync()
  assert.deepEqual(await store.findSerializedAsync(), [])
})

test('serialized reads refuse datastores that keep members in separate rows', async t => {
  const store = memory(t, { childField: 'videos' })
  await assert.rejects(store.findSerializedAsync(), /separate rows/)
})

test('history loads newest first and keeps the newest record of each video', () => {
  const records = [
    { _id: '1', videoId: 'a', timeWatched: 1 },
    { _id: '2', videoId: 'b', timeWatched: 5 },
    { _id: '3', videoId: 'a', timeWatched: 3 },
    { _id: '4', videoId: 'c' },
    { _id: '5', videoId: 'd', timeWatched: 5 },
    { _id: '6', videoId: 'b', timeWatched: 5 },
  ]
  const { records: unique, duplicateIds } = newestUniqueHistoryRecords(records)
  // Ties keep their stored order; records without a time go last.
  assert.deepEqual(unique.map(record => record._id), ['2', '5', '3', '4'])
  assert.deepEqual(duplicateIds, ['6', '1'])
})

async function electronHistory(t) {
  const [base, electron] = await Promise.all(['base', 'electron'].map(name =>
    readFile(new URL(`../../src/datastores/handlers/${name}.js`, import.meta.url), 'utf8')))
  const db = {
    settings: createDesktopDatastore(':memory:'),
    history: createDesktopDatastore(':memory:', undefined, { indexes: ['videoId'] }),
  }
  t.after(() => Object.values(db).forEach(store => store.driver.close()))
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  const main = vm.runInNewContext(base.slice(base.indexOf('class Settings {'), base.indexOf('\nclass WatchStats {')) + '\n({ History })', {
    db, ...seenVideos, migrateLegacyHistoryRecord, newestUniqueHistoryRecords, createIdQuery, migrateStoredSettings,
    recommendations: { remove: async () => {} },
    HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated',
  }).History
  const requests = []
  let beforeRemovingDuplicates = null
  // Mirrors the main process's history handler, including the copy across IPC.
  const handle = async (action) => {
    requests.push(action)
    if (action === DBActions.GENERAL.FIND) return structuredClone(await main._findSerialized())
    if (action === DBActions.HISTORY.REMOVE_DUPLICATES) {
      await beforeRemovingDuplicates?.()
      return structuredClone(await main.find())
    }
    throw new Error(`Unexpected action ${action}`)
  }
  const context = vm.createContext({ DBActions, newestUniqueHistoryRecords, runBackgroundJob: () => {}, window: { ftElectron: { dbHistory: handle } } })
  vm.runInContext(electron.replace(/^import .+\n/gm, '').replace(/export \{[\s\S]*?\}\n/g, '')
    .replace('export const recommendations', 'const recommendations') + '\nglobalThis.history = History', context)
  return { db, main, renderer: context.history, requests, setBeforeRemovingDuplicates: callback => { beforeRemovingDuplicates = callback } }
}

test('Electron windows load history from stored text exactly as the main process would build it', async t => {
  const { db, main, renderer, requests } = await electronHistory(t)
  await db.history.insertAsync(Array.from({ length: 50 }, (_, index) => ({
    videoId: `video-${index}`, title: `Video ${index}`, description: 'Text', isWatched: false, timeWatched: (index * 7) % 13,
  })))

  const records = await renderer.find()
  assert.deepEqual(requests, [DBActions.GENERAL.FIND])
  // The same order as NeDB's sort, including ties, which keep their stored order.
  const plain = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(records), await db.history.findAsync({}).sort({ timeWatched: -1 }))
  assert.deepEqual(plain(records), plain(await main.find()))
})

test('Electron windows have the main process remove duplicate history records', async t => {
  const { db, renderer, requests } = await electronHistory(t)
  await db.history.insertAsync([
    { videoId: 'video', timeWatched: 1 }, { videoId: 'video', timeWatched: 3 }, { videoId: 'other', timeWatched: 2 },
  ])

  const records = await renderer.find()
  assert.deepEqual(records.map(record => [record.videoId, record.timeWatched]), [['video', 3], ['other', 2]])
  assert.deepEqual(requests, [DBActions.GENERAL.FIND, DBActions.HISTORY.REMOVE_DUPLICATES])
  const stored = await db.history.findAsync({ videoId: 'video' })
  assert.deepEqual(stored.map(record => record._id), [records[0]._id])
})

test('Electron windows keep the records the main process selected when removing duplicates', async t => {
  const { db, renderer, setBeforeRemovingDuplicates } = await electronHistory(t)
  const [older] = await db.history.insertAsync([
    { videoId: 'video', timeWatched: 1 }, { videoId: 'video', timeWatched: 3 },
  ])
  // A write between the two requests makes the older record the newest one.
  setBeforeRemovingDuplicates(() => db.history.updateAsync({ _id: older._id }, { $set: { timeWatched: 5 } }))

  const records = await renderer.find()
  const stored = await db.history.findAsync({ videoId: 'video' })
  assert.deepEqual(stored.map(record => record._id), [older._id])
  assert.deepEqual(records.map(record => [record._id, record.timeWatched]), [[older._id, 5]])
})
