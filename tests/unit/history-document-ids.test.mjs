import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { migrateLegacyHistoryRecord } from '../../src/history.js'
import * as seenVideos from '../../src/subscriptionSeenVideos.js'
import { migrateStoredSettings } from '../../src/datastores/settingsMigrations.js'
import Datastore from '@seald-io/nedb'
import { createIdQuery } from '../../src/datastores/idQuery.js'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

// Released versions store data in NeDB; development builds use SQLite.
const backends = {
  NeDB: () => new Datastore({ inMemoryOnly: true }),
  SQLite: options => createDesktopDatastore(':memory:', undefined, options),
}

async function fixture(t, createDatastore) {
  const db = {
    settings: createDatastore(),
    history: createDatastore({ indexes: ['videoId'] }),
  }
  t.after(() => Object.values(db).forEach(store => store.driver?.close()))
  await db.settings.insertAsync({ _id: 'historyWatchedStatusMigrated', value: true })
  const { History } = vm.runInNewContext(
    source.slice(source.indexOf('class Settings {'), source.indexOf('\nclass WatchStats {')) + '\n({History})',
    {
      db,
      ...seenVideos,
      migrateLegacyHistoryRecord,
      migrateStoredSettings,
      createIdQuery,
      recommendations: { remove: async () => {} },
      HISTORY_WATCHED_STATUS_MIGRATION_ID: 'historyWatchedStatusMigrated',
    }
  )
  return { db, History }
}

const record = (videoId, fields = {}) => ({ videoId, title: videoId, isWatched: false, watchProgress: 0, timeWatched: 1, ...fields })

for (const [name, createDatastore] of Object.entries(backends)) {
  test(`${name}: history writes keep the stored document ID when the record carries another one`, async t => {
    const { db, History } = await fixture(t, createDatastore)
    const { _id } = await db.history.insertAsync(record('video'))
    const stale = record('video', { _id: 'stale-id', watchProgress: 30, timeWatched: 2 })

    await History.applySyncChanges({ insertions: [], updates: [stale], deletions: [] })
    await History.upsert({ ...stale, watchProgress: 40 })
    const result = await History.updateSubscriptionState({ records: [{ ...stale, watchProgress: 50 }] })

    const stored = await db.history.findAsync({ videoId: 'video' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0]._id, _id)
    assert.equal(stored[0].watchProgress, 50)
    assert.equal(result.records[0]._id, _id)
  })

  test(`${name}: sync insertions update a record written locally while the sync was running`, async t => {
    const { db, History } = await fixture(t, createDatastore)
    await History.upsert(record('video', { timeWatched: 1 }))

    await History.applySyncChanges({ insertions: [record('video', { timeWatched: 2 }), record('other')], updates: [], deletions: [] })

    const stored = await db.history.findAsync({ videoId: 'video' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].timeWatched, 2)
    assert.equal(await db.history.countAsync({ videoId: 'other' }), 1)
  })

  test(`${name}: sync insertions keep a record watched more recently in another window`, async t => {
    const { db, History } = await fixture(t, createDatastore)
    await History.upsert(record('video', { timeWatched: 3, watchProgress: 30 }))

    const skipped = await History.applySyncChanges({ insertions: [record('video', { timeWatched: 2 }), record('other')], updates: [], deletions: [] })

    assert.deepEqual([...skipped], ['video'])
    const stored = await db.history.findAsync({ videoId: 'video' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].timeWatched, 3)
    assert.equal(stored[0].watchProgress, 30)
  })

  test(`${name}: sync insertions replace a progress-only record`, async t => {
    const { db, History } = await fixture(t, createDatastore)
    await History.updateWatchProgress('video', 20)

    const skipped = await History.applySyncChanges({ insertions: [record('video', { timeWatched: 2 })], updates: [], deletions: [] })

    assert.deepEqual([...skipped], [])
    const stored = await db.history.findAsync({ videoId: 'video' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].timeWatched, 2)
    assert.equal(stored[0].title, 'video')
  })

  test(`${name}: playback writes wait for a running sync instead of creating a duplicate`, async t => {
    const { db, History } = await fixture(t, createDatastore)
    const findAsync = db.history.findAsync.bind(db.history)
    const lookup = Promise.withResolvers()
    const release = Promise.withResolvers()
    db.history.findAsync = (...args) => {
      lookup.resolve()
      return release.promise.then(() => findAsync(...args))
    }

    const sync = History.applySyncChanges({ insertions: [record('video', { timeWatched: 2 })], updates: [], deletions: [] })
    await lookup.promise
    const playback = History.upsert(record('video', { timeWatched: 3 }))
    const progress = History.updateWatchProgress('video', 20)
    release.resolve()
    await Promise.all([sync, playback, progress])

    db.history.findAsync = findAsync
    const stored = await db.history.findAsync({ videoId: 'video' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].timeWatched, 3)
    assert.equal(stored[0].watchProgress, 20)
  })

  test(`${name}: a sync waits for a history overwrite instead of creating a duplicate`, async t => {
    const { db, History } = await fixture(t, createDatastore)
    await History.upsert(record('video'))
    const removeAsync = db.history.removeAsync.bind(db.history)
    const removing = Promise.withResolvers()
    const release = Promise.withResolvers()
    db.history.removeAsync = async (...args) => {
      const result = await removeAsync(...args)
      removing.resolve()
      await release.promise
      return result
    }

    const overwrite = History.overwrite([record('video', { timeWatched: 2 })])
    await removing.promise
    const sync = History.applySyncChanges({ insertions: [record('video', { timeWatched: 3 })], updates: [], deletions: [] })
    release.resolve()
    await Promise.all([overwrite, sync])

    db.history.removeAsync = removeAsync
    const stored = await db.history.findAsync({ videoId: 'video' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].timeWatched, 3)
  })

  test(`${name}: loading history removes older duplicates so later writes target the kept record`, async t => {
    const { db, History } = await fixture(t, createDatastore)
    await db.history.insertAsync([record('video', { timeWatched: 1 }), record('video', { timeWatched: 3 }), record('other', { timeWatched: 2 })])

    const records = await History.find()
    assert.deepEqual(records.map(entry => [entry.videoId, entry.timeWatched]), [['video', 3], ['other', 2]])
    const stored = await db.history.findAsync({ videoId: 'video' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0]._id, records[0]._id)

    await History.applySyncChanges({ insertions: [], updates: [{ ...records[0], watchProgress: 10 }], deletions: [] })
    assert.equal((await db.history.findOneAsync({ videoId: 'video' })).watchProgress, 10)
  })
}
