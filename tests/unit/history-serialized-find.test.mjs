import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { DBActions } from '../../src/constants.js'
import { HISTORY_DESCRIPTION_MAX_LENGTH, migrateLegacyHistoryRecord, newestUniqueHistoryRecords } from '../../src/history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'
import { createIdQuery } from '../../src/datastores/idQuery.js'
import { DATASTORE_OPTIONS } from '../../src/datastores/datastoreOptions.js'
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

test('history keeps the start of long descriptions, and shortens ones saved before the limit once, the same way', async t => {
  // More code points than the limit, and more UTF-16 units than code points
  const long = 'é😀'.repeat(HISTORY_DESCRIPTION_MAX_LENGTH) + 'end'
  const capped = migrateLegacyHistoryRecord({ videoId: 'long', isWatched: true, description: long }).description
  assert.equal([...capped].length, HISTORY_DESCRIPTION_MAX_LENGTH)
  assert.ok(long.startsWith(capped) && capped.endsWith('😀'))
  // Exactly the limit in code points, but longer in UTF-16 units
  const fitting = { videoId: 'fitting', isWatched: true, description: 'é😀'.repeat(HISTORY_DESCRIPTION_MAX_LENGTH / 2) }
  assert.equal(migrateLegacyHistoryRecord(fitting), fitting)

  // A history saved before the limit
  const driver = createNodeSqliteDriver(':memory:')
  t.after(() => driver.close())
  const saved = { _id: 'long', videoId: 'long', title: 'Ünïcode "quoted"\n', description: long, timeWatched: 7, watchProgress: 1, published: new Date(5) }
  await new SqliteDatastore({ driver }).insertAsync([
    saved,
    { _id: 'fitting', ...fitting },
    { _id: 'number', videoId: 'number', description: 12345 },
    { _id: 'none', videoId: 'none', title: 'x'.repeat(HISTORY_DESCRIPTION_MAX_LENGTH * 2) },
  ])
  const stored = async () => new Map((await driver.execute([['SELECT id, data FROM docs']]))[0])
  const before = await stored()

  // Opening it shortens them before the first read, and keeps the other fields and dates
  const history = new SqliteDatastore({ driver, ...DATASTORE_OPTIONS.history })
  assert.deepEqual(await history.findAsync({ videoId: 'long' }), [{ ...saved, description: capped }])
  const after = await stored()
  for (const id of ['fitting', 'number', 'none']) assert.equal(after.get(id), before.get(id))
  const [[[ran]]] = await driver.execute([['SELECT value FROM meta WHERE key = ?', [`update:historyDescriptions${HISTORY_DESCRIPTION_MAX_LENGTH}`]]])
  assert.ok(ran > 0)
  // Running it again changes nothing
  await driver.execute([[DATASTORE_OPTIONS.history.updates[0].sql]])
  assert.deepEqual(await stored(), after)

  // It runs once: a long description saved afterwards stays until its record is next written
  await new SqliteDatastore({ driver }).updateAsync({ _id: 'long' }, saved)
  const reopened = new SqliteDatastore({ driver, ...DATASTORE_OPTIONS.history })
  assert.equal((await reopened.findOneAsync({ _id: 'long' })).description, long)

  // Importing a legacy history shortens them too
  const imported = memory(t, { ...DATASTORE_OPTIONS.history, legacy: { read: async () => ({ data: [saved], indexes: [] }) } })
  assert.deepEqual(await imported.findOneAsync({ _id: 'long' }), { ...saved, description: capped })
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
    db,
    ...seenVideos,
    migrateLegacyHistoryRecord,
    newestUniqueHistoryRecords,
    createIdQuery,
    migrateStoredSettings,
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
  const context = vm.createContext({ DBActions, newestUniqueHistoryRecords, runBackgroundJob: () => {}, getDataScope: () => null, withDataScope: (_scope, operation) => operation(), window: { ftElectron: { dbHistory: handle } } })
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
