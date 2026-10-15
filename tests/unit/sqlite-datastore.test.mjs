import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { promisify } from 'node:util'
import Datastore from '@seald-io/nedb'
import { SqliteDatastore } from '../../src/datastores/sqlite.js'
import { createDesktopDatastore, createNedbFileSource, createNodeSqliteDriver } from '../../src/datastores/sqliteNode.js'

const lines = docs => docs.map(doc => typeof doc === 'string' ? doc : JSON.stringify(doc)).join('\n') + '\n'
const video = (videoId, playlistItemId = `item-${videoId}`) => ({ videoId, playlistItemId, title: `Title ${videoId}`, timeAdded: 1 })

async function directory (t) {
  const path = await mkdtemp(join(tmpdir(), 'opentubex-sqlite-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

function open (t, dir, name, options = {}) {
  const store = createDesktopDatastore(join(dir, `${name}.sqlite`), join(dir, `${name}.db`), options)
  t.after(() => store.driver.close())
  return store
}

function memory (t, options = {}) {
  const store = new SqliteDatastore({ driver: createNodeSqliteDriver(':memory:'), ...options })
  t.after(() => store.driver.close())
  return store
}

/** Simulates a bridge or worker: every call resolves on a later task. */
function slowDriver (driver, beforeExecute = () => {}) {
  return {
    ...driver,
    async execute (statements, transaction) {
      await new Promise(resolve => setTimeout(resolve, 1))
      beforeExecute(statements)
      return driver.execute(statements, transaction)
    }
  }
}

async function loadWithNedb (filename) {
  const copy = `${filename}.nedb-copy`
  await writeFile(copy, await readFile(filename))
  const datastore = new Datastore({ filename: copy, corruptAlertThreshold: 1 })
  await datastore.loadDatabaseAsync()
  return datastore.findAsync({}).sort({ _id: 1 })
}

/** Edits a legacy file the way an older version of the app would. */
async function editAsOlderVersion (filename, edit) {
  const datastore = new Datastore({ filename, corruptAlertThreshold: 1 })
  await datastore.loadDatabaseAsync()
  await edit(datastore)
  await datastore.compactDatafileAsync()
}

test('imports a legacy NeDB log exactly as NeDB loads it and leaves the file untouched', async (t) => {
  const dir = await directory(t)
  const legacy = lines([
    { _id: 'a', videoId: 'a', watchProgress: 1, timeWatched: 3 },
    { _id: 'b', videoId: 'b', watchedAt: { $$date: 1700000000000 }, nested: { list: [1, 'two', null] } },
    { _id: 'a', videoId: 'a', watchProgress: 50, timeWatched: 3 },
    { _id: 'c', videoId: 'c' },
    { $$deleted: true, _id: 'c' },
    { $$indexCreated: { fieldName: 'videoId' } },
    '{"_id":"broken",',
    { _id: 'd', videoId: 'd', title: 'Ünïcödé ✓ "quoted"\n' },
  ])
  await writeFile(join(dir, 'history.db'), legacy)
  const expected = await loadWithNedb(join(dir, 'history.db'))

  const store = open(t, dir, 'history')
  assert.deepEqual(await store.findAsync({}).sort({ _id: 1 }), expected)
  assert.ok((await store.findOneAsync({ _id: 'b' })).watchedAt instanceof Date)
  assert.equal(await readFile(join(dir, 'history.db'), 'utf8'), legacy, 'an older version can still open the legacy file')
})

test('imports playlists with every member, duplicate and order intact', async (t) => {
  const dir = await directory(t)
  const videos = Array.from({ length: 5000 }, (_, index) => video(`v${index % 50}`, `item-${index}`))
  const playlists = [
    { _id: 'big', playlistName: 'Big', protected: false, videos, lastUpdatedAt: 1 },
    { _id: 'empty', playlistName: 'Empty', videos: [] },
    { _id: 'noVideos', playlistName: 'Without array' },
  ]
  await writeFile(join(dir, 'playlists.db'), lines(playlists))

  const store = open(t, dir, 'playlists', { childField: 'videos' })
  assert.deepEqual(await store.findAsync({}).sort({ _id: 1 }), [...playlists].sort((a, b) => a._id.localeCompare(b._id)))
})

test('an interrupted import is discarded and repeated without duplicates', async (t) => {
  const dir = await directory(t)
  const videos = Array.from({ length: 4500 }, (_, index) => video(`v${index}`))
  const docs = [{ _id: 'p', playlistName: 'P', videos }, { _id: 'q', playlistName: 'Q', videos: [video('x')] }]
  await writeFile(join(dir, 'playlists.db'), lines(docs))

  // Fail after the first committed batch, as if the app quit during the import.
  const driver = createNodeSqliteDriver(join(dir, 'playlists.sqlite'))
  let batches = 0
  const interrupted = new SqliteDatastore({
    driver: slowDriver(driver, statements => {
      if (statements.some(([sql]) => sql.startsWith('INSERT INTO children')) && ++batches === 2) throw new Error('quit')
    }),
    legacy: createNedbFileSource(join(dir, 'playlists.db')),
    childField: 'videos',
  })
  await assert.rejects(interrupted.findAsync({}), /quit/)
  driver.close()

  const store = open(t, dir, 'playlists', { childField: 'videos' })
  assert.deepEqual(await store.findAsync({}).sort({ _id: 1 }), docs)
})

test('recovers NeDB\'s temporary file when the main legacy file is missing', async (t) => {
  const dir = await directory(t)
  await writeFile(join(dir, 'profiles.db~'), lines([{ _id: 'allChannels', name: 'All' }]))
  const store = open(t, dir, 'profiles')
  assert.deepEqual(await store.findAsync({}), [{ _id: 'allChannels', name: 'All' }])
})

test('starts empty without a legacy file and persists across reopening', async (t) => {
  const dir = await directory(t)
  const store = open(t, dir, 'search-history')
  await store.insertAsync({ _id: 'q', query: 'q', lastUpdatedAt: 5 })
  store.driver.close()
  const reopened = open(t, dir, 'search-history')
  assert.deepEqual(await reopened.findAsync({}), [{ _id: 'q', query: 'q', lastUpdatedAt: 5 }])
})

test('an unchanged legacy file is neither imported again nor applied', async (t) => {
  const dir = await directory(t)
  await writeFile(join(dir, 'settings.db'), lines([{ _id: 'x', value: 1 }]))
  const first = open(t, dir, 'settings')
  await first.updateAsync({ _id: 'x' }, { $set: { value: 2 } })
  first.driver.close()
  const reopened = open(t, dir, 'settings')
  assert.deepEqual(await reopened.findAsync({}), [{ _id: 'x', value: 2 }])
})

test('applies what an older version changed after a downgrade and keeps newer edits', async (t) => {
  const dir = await directory(t)
  const legacyFile = join(dir, 'playlists.db')
  await writeFile(legacyFile, lines([
    { _id: 'editedOld', playlistName: 'A', videos: [video('a')] },
    { _id: 'deletedOld', playlistName: 'B', videos: [] },
    { _id: 'editedNew', playlistName: 'C', videos: [video('c')] },
    { _id: 'untouched', playlistName: 'D', videos: [] },
  ]))
  const changes = []
  const options = { childField: 'videos', onLegacyChanges: change => changes.push(change) }
  const store = open(t, dir, 'playlists', options)
  await store.updateAsync({ _id: 'editedNew' }, { $push: { videos: video('newer') } })
  await store.insertAsync({ _id: 'sameId', playlistName: 'Created here', videos: [] })
  store.driver.close()

  await editAsOlderVersion(legacyFile, async older => {
    await older.updateAsync({ _id: 'editedOld' }, { $push: { videos: video('older') } })
    await older.removeAsync({ _id: 'deletedOld' })
    await older.insertAsync({ _id: 'addedOld', playlistName: 'E', videos: [] })
    await older.insertAsync({ _id: 'sameId', playlistName: 'Default from older version', videos: [] })
  })

  const reopened = open(t, dir, 'playlists', options)
  assert.deepEqual(await reopened.findAsync({}).sort({ _id: 1 }), [
    { _id: 'addedOld', playlistName: 'E', videos: [] },
    { _id: 'editedNew', playlistName: 'C', videos: [video('c'), video('newer')] },
    { _id: 'editedOld', playlistName: 'A', videos: [video('a'), video('older')] },
    { _id: 'sameId', playlistName: 'Created here', videos: [] },
    { _id: 'untouched', playlistName: 'D', videos: [] },
  ])
  assert.equal(changes.length, 1)
  assert.equal(changes[0].changed, 2)
  assert.equal(changes[0].deleted, 1)
  assert.ok(existsSync(changes[0].backup), 'the database is backed up before applying them')
  const backup = new DatabaseSync(changes[0].backup, { readOnly: true })
  assert.equal(backup.prepare('SELECT count(*) AS count FROM docs').get().count, 5)
  backup.close()

  reopened.driver.close()
  const again = open(t, dir, 'playlists', options)
  await again.findAsync({})
  assert.equal(changes.length, 1, 'the same legacy changes are applied once')
})

test('changes from an older version wait for the next start when the backup fails', async (t) => {
  const dir = await directory(t)
  const legacyFile = join(dir, 'settings.db')
  await writeFile(legacyFile, lines([{ _id: 'theme', value: 'dark' }]))
  const store = open(t, dir, 'settings')
  await store.updateAsync({ _id: 'theme' }, { $set: { value: 'light' } })
  store.driver.close()
  await editAsOlderVersion(legacyFile, older => older.updateAsync({ _id: 'theme' }, { $set: { value: 'older' } }))

  const changes = []
  const failing = open(t, dir, 'settings', { onLegacyChanges: change => changes.push(change) })
  failing.driver.backup = async () => { throw new Error('disk full') }
  t.mock.method(console, 'error', () => {})
  assert.deepEqual(await failing.findAsync({}), [{ _id: 'theme', value: 'light' }], 'the library still opens unchanged')
  assert.deepEqual(changes, [])
  failing.driver.close()

  const retried = open(t, dir, 'settings', { onLegacyChanges: change => changes.push(change) })
  assert.deepEqual(await retried.findAsync({}), [{ _id: 'theme', value: 'older' }])
  assert.equal(changes.length, 1)
})

test('a downgrade on a fresh installation adds only documents that do not exist yet', async (t) => {
  const dir = await directory(t)
  const store = open(t, dir, 'profiles')
  await store.insertAsync({ _id: 'allChannels', subscriptions: [{ id: 'channel' }] })
  store.driver.close()

  await editAsOlderVersion(join(dir, 'profiles.db'), async older => {
    await older.insertAsync({ _id: 'allChannels', subscriptions: [] })
    await older.insertAsync({ _id: 'other', subscriptions: [] })
  })

  const reopened = open(t, dir, 'profiles')
  assert.deepEqual(await reopened.findAsync({}).sort({ _id: 1 }), [
    { _id: 'allChannels', subscriptions: [{ id: 'channel' }] },
    { _id: 'other', subscriptions: [] },
  ])
})

test('dropping a store deletes it and its legacy file, without recreating it on reads', async (t) => {
  const dir = await directory(t)
  await writeFile(join(dir, 'video-metadata-cache.db'), lines([{ _id: 'a', videoId: 'v' }]))
  const store = open(t, dir, 'video-metadata-cache', { indexes: ['videoId'] })
  assert.equal((await store.findAsync({ videoId: 'v' })).length, 1)
  await store.dropDatabaseAsync()
  assert.deepEqual(readdirSync(dir), [])
  assert.deepEqual(await store.findAsync({}), [])
  await store.compactDatafileAsync()
  assert.deepEqual(readdirSync(dir), [], 'reading or compacting does not recreate the file')
  await store.insertAsync({ _id: 'b', videoId: 'v' })
  assert.deepEqual(await store.findAsync({ videoId: 'v' }), [{ _id: 'b', videoId: 'v' }])
})

test('refuses a database written by a newer schema instead of altering it', async (t) => {
  const dir = await directory(t)
  const db = new DatabaseSync(join(dir, 'settings.sqlite'))
  db.exec('PRAGMA user_version = 99')
  db.close()
  const store = open(t, dir, 'settings')
  await assert.rejects(store.findAsync({}), /newer version/)
  store.driver.close()
  const reopened = new DatabaseSync(join(dir, 'settings.sqlite'), { readOnly: true })
  assert.deepEqual(reopened.prepare('SELECT name FROM sqlite_master').all(), [], 'no tables are created')
  reopened.close()
})

test('playlist edits write only the rows they change', async (t) => {
  const dir = await directory(t)
  const store = open(t, dir, 'playlists', { childField: 'videos' })
  const videos = Array.from({ length: 2000 }, (_, index) => video(`v${index}`))
  await store.insertAsync({ _id: 'p', playlistName: 'Before', videos, lastUpdatedAt: 1 })
  const totalChanges = async () => (await store.driver.execute([['SELECT total_changes()']]))[0][0][0]
  const changes = async operation => {
    const before = await totalChanges()
    await operation()
    return await totalChanges() - before
  }

  assert.equal(await changes(() => store.updateAsync({ _id: 'p' }, { $set: { playlistName: 'After', lastUpdatedAt: 2 } })), 1)
  assert.equal(await changes(() => store.updateAsync({ _id: 'p', $not: { videos: { $elemMatch: { videoId: 'new' } } } }, { $push: { videos: video('new') } })), 2)
  assert.equal(await changes(() => store.updateAsync({ _id: 'p' }, { $pull: { videos: { playlistItemId: 'item-v5' } } })), 2)

  const saved = await store.findOneAsync({ _id: 'p' })
  assert.equal(saved.playlistName, 'After')
  assert.deepEqual(saved.videos, [...videos.filter(entry => entry.videoId !== 'v5'), video('new')])
})

test('operations through an asynchronous driver run one at a time', async (t) => {
  const store = new SqliteDatastore({ driver: slowDriver(createNodeSqliteDriver(':memory:')), childField: 'videos' })
  t.after(() => store.driver.close())
  await store.insertAsync({ _id: 'p', videos: [] })
  // Each add only succeeds when the video is absent; concurrent adds must
  // still see each other's result.
  const add = videoId => store.updateAsync(
    { _id: 'p', $not: { videos: { $elemMatch: { videoId } } } },
    { $push: { videos: video(videoId) } }
  )
  const results = await Promise.all([add('a'), add('a'), add('b'), add('a')])
  assert.deepEqual(results.map(result => result.numAffected), [1, 0, 1, 0])
  assert.deepEqual((await store.findOneAsync({ _id: 'p' })).videos, [video('a'), video('b')])
  await assert.rejects(Promise.all([store.insertAsync({ _id: 'x' }), store.insertAsync({ _id: 'x' })]), error => error.errorType === 'uniqueViolated')
  assert.equal((await store.findAsync({ _id: 'x' })).length, 1)
})

test('reassembled playlists keep their key order for snapshot comparisons', async (t) => {
  const store = memory(t, { childField: 'videos' })
  await store.insertAsync({ _id: 'p', playlistName: 'A', videos: [video('a')], protected: true })
  const snapshot = JSON.stringify(await store.findOneAsync({ _id: 'p' }))
  assert.equal(snapshot, JSON.stringify({ _id: 'p', playlistName: 'A', videos: [video('a')], protected: true }))
  const { numAffected } = await store.updateAsync({ _id: 'p', $where () { return JSON.stringify(this) === snapshot } }, { $set: { playlistName: 'B' } })
  assert.equal(numAffected, 1)
})

test('rejects duplicate IDs and invalid updates without partial writes', async (t) => {
  const store = memory(t)
  await store.insertAsync({ _id: 'a' })
  await assert.rejects(store.insertAsync([{ _id: 'b' }, { _id: 'a' }]), error => error.errorType === 'uniqueViolated')
  await assert.rejects(store.insertAsync([{ _id: 'c' }, { _id: 'c' }]), error => error.errorType === 'uniqueViolated')
  assert.deepEqual(await store.findAsync({}), [{ _id: 'a' }])
  await assert.rejects(store.updateAsync({}, { $set: { _id: 'c' } }))
  assert.deepEqual(await store.findAsync({}), [{ _id: 'a' }])
})

test('indexed lookups find string and numeric IDs exactly like NeDB', async (t) => {
  const store = memory(t, { indexes: ['videoId'] })
  await store.insertAsync([{ _id: '5', videoId: 'x' }, { _id: 5, videoId: 'y' }, { _id: 'z', videoId: ['x'] }])
  assert.deepEqual(await store.findAsync({ _id: 5 }), [{ _id: 5, videoId: 'y' }])
  assert.deepEqual(await store.findAsync({ _id: { $in: ['5'] } }), [{ _id: '5', videoId: 'x' }])
  // An array field is not an indexed scalar, but NeDB matches its members.
  assert.deepEqual((await store.findAsync({ videoId: 'x' })).map(doc => doc._id).sort(), ['5', 'z'])
})

test('existing NeDB handler tests pass against SQLite', async () => {
  const files = [
    'history-unseen-marks', 'playlist-repair', 'profile-loading', 'recommendation-learning', 'playlist-loading',
    'recommendation-history-removal', 'setting-repair', 'subscription-cache-writes', 'subscription-history-atomic',
    'sync-seen-videos',
  ].map(name => `tests/unit/${name}.test.mjs`)
  await promisify(execFile)(process.execPath, ['--import', './tests/helpers/nedb-as-sqlite.mjs', '--test', ...files], { maxBuffer: 64 * 1024 * 1024 })
})
