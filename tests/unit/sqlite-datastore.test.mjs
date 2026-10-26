import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { promisify } from 'node:util'
import Datastore from '@seald-io/nedb'
import { SqliteDatastore } from '../../src/datastores/sqlite.js'
import { createDesktopDatastore, createNedbFileSource, createNodeSqliteDriver, createWorkerDrivers, desktopDatastorePaths } from '../../src/datastores/sqliteNode.js'

const lines = docs => docs.map(doc => typeof doc === 'string' ? doc : JSON.stringify(doc)).join('\n') + '\n'
const video = (videoId, playlistItemId = `item-${videoId}`) => ({ videoId, playlistItemId, title: `Title ${videoId}`, timeAdded: 1 })

async function directory (t) {
  // Resolved, as macOS keeps the temporary directory behind a symbolic link.
  const path = realpathSync(await mkdtemp(join(tmpdir(), 'opentubex-sqlite-')))
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

test('reports an import only for an existing legacy file, once', async (t) => {
  const dir = await directory(t)
  const imported = []
  const options = { onLegacyImported: result => imported.push(result) }
  await writeFile(join(dir, 'settings.db'), lines([{ _id: 'a', value: 1 }, { _id: 'b', value: 2 }]))
  const store = open(t, dir, 'settings', options)
  await store.findAsync({})
  store.driver.close()
  await open(t, dir, 'settings', options).findAsync({})
  await open(t, dir, 'history', options).findAsync({})
  assert.deepEqual(imported, [{ documents: 2 }])
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

test('an unreadable legacy file does not lock an imported library', async (t) => {
  const dir = await directory(t)
  const legacyFile = join(dir, 'settings.db')
  await writeFile(legacyFile, lines([{ _id: 'theme', value: 'dark' }]))
  const store = open(t, dir, 'settings')
  await store.updateAsync({ _id: 'theme' }, { $set: { value: 'light' } })
  store.driver.close()
  await editAsOlderVersion(legacyFile, older => older.updateAsync({ _id: 'theme' }, { $set: { value: 'older' } }))

  const reopened = open(t, dir, 'settings')
  reopened.legacy.read = async () => { throw new Error('EIO: i/o error') }
  t.mock.method(console, 'error', () => {})
  assert.deepEqual(await reopened.findAsync({}), [{ _id: 'theme', value: 'light' }])
  assert.equal(console.error.mock.callCount(), 1)
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

test('operations queued behind a drop do not recreate the database', async (t) => {
  const dir = await directory(t)
  const store = open(t, dir, 'video-metadata-cache')
  await store.insertAsync({ _id: 'a' })
  const queued = [store.dropDatabaseAsync(), store.compactDatafileAsync(), store.findAsync({})]
  const [, , found] = await Promise.all(queued)
  assert.deepEqual(found, [])
  assert.deepEqual(readdirSync(dir), [])
})

test('a newer library that cannot be opened can still be dropped', async (t) => {
  const dir = await directory(t)
  const db = new DatabaseSync(join(dir, 'video-metadata-cache.sqlite'))
  db.exec('PRAGMA user_version = 99')
  db.close()
  const store = open(t, dir, 'video-metadata-cache')
  await store.dropDatabaseAsync()
  assert.deepEqual(readdirSync(dir), [])
})

test('changes from an older version are not applied when the driver cannot back up', async (t) => {
  const dir = await directory(t)
  const legacyFile = join(dir, 'settings.db')
  await writeFile(legacyFile, lines([{ _id: 'theme', value: 'dark' }]))
  const store = open(t, dir, 'settings')
  await store.findAsync({})
  store.driver.close()
  await editAsOlderVersion(legacyFile, older => older.updateAsync({ _id: 'theme' }, { $set: { value: 'older' } }))

  const reopened = open(t, dir, 'settings')
  delete reopened.driver.backup
  t.mock.method(console, 'error', () => {})
  assert.deepEqual(await reopened.findAsync({}), [{ _id: 'theme', value: 'dark' }])
})

test('a symlinked legacy file keeps the library beside its target', async (t) => {
  const dir = await directory(t)
  const profile = join(dir, 'profile')
  const external = join(dir, 'external')
  mkdirSync(profile)
  mkdirSync(external)
  await writeFile(join(external, 'history.db'), lines([{ _id: 'a', videoId: 'v' }]))
  symlinkSync(join(external, 'history.db'), join(profile, 'history.db'))
  assert.deepEqual(desktopDatastorePaths(profile, 'history'), {
    legacy: join(external, 'history.db'), filename: join(external, 'history.sqlite')
  })
  assert.deepEqual(desktopDatastorePaths(profile, 'settings'), {
    legacy: join(profile, 'settings.db'), filename: join(profile, 'settings.sqlite')
  })
})

test('a dangling legacy link resolves without throwing and has nothing to import', async (t) => {
  const dir = await directory(t)
  const profile = join(dir, 'profile')
  const external = join(dir, 'external')
  mkdirSync(profile)
  mkdirSync(external)
  symlinkSync(join(external, 'video-metadata-cache.db'), join(profile, 'video-metadata-cache.db'))
  const paths = desktopDatastorePaths(profile, 'video-metadata-cache')
  assert.deepEqual(paths, {
    legacy: join(external, 'video-metadata-cache.db'), filename: join(external, 'video-metadata-cache.sqlite')
  })
  const store = createDesktopDatastore(paths.filename, paths.legacy)
  t.after(() => store.driver.close())
  assert.deepEqual(await store.findAsync({}), [])
})

test('backups go to the given directory', async (t) => {
  const dir = await directory(t)
  const driver = createNodeSqliteDriver(join(dir, 'library', 'history.sqlite'), dir)
  mkdirSync(join(dir, 'library'))
  t.after(() => driver.close())
  await driver.execute([['CREATE TABLE a (b)']])
  const backup = await driver.backup()
  assert.equal(dirname(backup), dir)
  assert.ok(existsSync(backup))
})

test('new databases use the write-ahead log and incremental vacuum', async (t) => {
  const dir = await directory(t)
  const store = open(t, dir, 'settings')
  await store.insertAsync({ _id: 'a' })
  store.driver.close()
  const db = new DatabaseSync(join(dir, 'settings.sqlite'), { readOnly: true })
  assert.deepEqual([{ ...db.prepare('PRAGMA journal_mode').get() }, { ...db.prepare('PRAGMA auto_vacuum').get() }], [{ journal_mode: 'wal' }, { auto_vacuum: 2 }])
  db.close()
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
  assert.deepEqual({ ...reopened.prepare('PRAGMA journal_mode').get() }, { journal_mode: 'delete' }, 'its journal mode is unchanged')
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

test('array edits write only the members they add, remove or move', async (t) => {
  const store = memory(t, { childField: 'videos' })
  const videos = Array.from({ length: 6 }, (_, index) => video(`v${index}`))
  await store.insertAsync({ _id: 'p', videos })
  const totalChanges = async () => (await store.driver.execute([['SELECT total_changes()']]))[0][0][0]
  const changes = async operation => {
    const before = await totalChanges()
    await operation()
    return await totalChanges() - before
  }
  const saved = async () => (await store.findOneAsync({ _id: 'p' })).videos
  const set = videos => store.updateAsync({ _id: 'p' }, { $set: { videos } })

  // Adding to the top writes the document and the new member only
  let expected = [video('top'), ...videos]
  assert.equal(await changes(() => set(expected)), 2)
  assert.deepEqual(await saved(), expected)

  // Swapping neighbours rewrites just those two rows
  expected = [expected[0], expected[2], expected[1], ...expected.slice(3)]
  assert.equal(await changes(() => set(expected)), 5)
  assert.deepEqual(await saved(), expected)

  // Removing from the middle deletes one row
  expected = expected.filter(entry => entry.videoId !== 'v3')
  assert.equal(await changes(() => set(expected)), 2)
  assert.deepEqual(await saved(), expected)

  // An insertion fits into the position that removal freed
  expected = [...expected.slice(0, 4), video('mid'), ...expected.slice(4)]
  assert.equal(await changes(() => set(expected)), 2)
  assert.deepEqual(await saved(), expected)

  // Without a free position the members after the insertion move along
  expected = [...expected.slice(0, 4), video('mid-2'), ...expected.slice(4)]
  assert.equal(await changes(() => set(expected)), 8)
  assert.deepEqual(await saved(), expected)

  await store.updateAsync({ _id: 'p' }, { $push: { videos: video('last') } })
  assert.deepEqual(await saved(), [...expected, video('last')])
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

test('removing every document deletes members without reading any document', async (t) => {
  const driver = createNodeSqliteDriver(':memory:')
  const statements = []
  const store = new SqliteDatastore({ driver: slowDriver(driver, executed => statements.push(...executed.map(([sql]) => sql))), childField: 'videos' })
  t.after(() => driver.close())
  await store.insertAsync([{ _id: 'p', videos: [video('a'), video('b')] }, { _id: 'q' }])

  statements.length = 0
  assert.equal(await store.removeAsync({}, { multi: true }), 2)
  assert.equal(statements.some(sql => sql.startsWith('SELECT id, data')), false)
  assert.deepEqual(await store.findAsync({}), [])
  assert.deepEqual(await driver.execute([['SELECT count(*) FROM children']]), [[[0]]])

  // Without multi, NeDB removes only the first match.
  await store.insertAsync([{ _id: 'r' }, { _id: 's' }])
  assert.equal(await store.removeAsync({}), 1)
  assert.equal((await store.findAsync({})).length, 1)
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

test('modifier paths cannot reach shared prototypes', async (t) => {
  const store = memory(t)
  await store.insertAsync({ _id: 'a' })
  // Field names of an imported playlist become `$set` paths.
  const fields = JSON.parse('{"constructor.prototype.polluted": 1, "__proto__.polluted": 1, "a.__proto__": {"polluted": 1}}')
  try {
    for (const [field, value] of Object.entries(fields)) {
      await assert.rejects(store.updateAsync({ _id: 'a' }, { $set: { [field]: value } }))
      await assert.rejects(store.updateAsync({ _id: 'b' }, { $set: { [field]: value } }, { upsert: true }))
    }
    assert.equal(Object.prototype.polluted, undefined)
  } finally {
    delete Object.prototype.polluted
  }
  assert.deepEqual(await store.findAsync({}), [{ _id: 'a' }])
})

test('replaceAllAsync keeps every document when a replacement is invalid', async (t) => {
  const store = memory(t, { childField: 'videos' })
  await store.insertAsync([{ _id: 'a', videos: [{ videoId: 'v' }] }, { _id: 'b' }])
  for (const docs of [[{ _id: 'c' }, { _id: 'c' }], [{ _id: 'c', 'a.b': 1 }]]) {
    await assert.rejects(store.replaceAllAsync(docs))
  }
  assert.deepEqual(await store.findAsync({}).sort({ _id: 1 }), [{ _id: 'a', videos: [{ videoId: 'v' }] }, { _id: 'b' }])
  await store.replaceAllAsync([{ _id: 'a' }, { _id: 'c', videos: [{ videoId: 'w' }] }])
  assert.deepEqual(await store.findAsync({}).sort({ _id: 1 }), [{ _id: 'a' }, { _id: 'c', videos: [{ videoId: 'w' }] }])
})

test('large batch inserts check duplicate IDs in linear time', async (t) => {
  const store = memory(t)
  const docs = Array.from({ length: 20000 }, (_, index) => ({ _id: `video-${index}` }))
  const indexOf = Array.prototype.indexOf
  let scans = 0
  // A synced history inserts every record at once; scanning the batch per key stalled Android's UI thread.
  Array.prototype.indexOf = function (...args) {
    if (this.length >= docs.length) scans++
    return indexOf.apply(this, args)
  }
  try {
    await store.insertAsync(docs)
  } finally {
    Array.prototype.indexOf = indexOf
  }
  assert.equal(scans, 0)
  assert.equal(await store.countAsync({}), docs.length)
})

test('indexed lookups find string and numeric IDs exactly like NeDB', async (t) => {
  const store = memory(t, { indexes: ['videoId'] })
  await store.insertAsync([{ _id: '5', videoId: 'x' }, { _id: 5, videoId: 'y' }, { _id: 'z', videoId: ['x'] }])
  assert.deepEqual(await store.findAsync({ _id: 5 }), [{ _id: 5, videoId: 'y' }])
  assert.deepEqual(await store.findAsync({ _id: { $in: ['5'] } }), [{ _id: '5', videoId: 'x' }])
  // An array field is not an indexed scalar, but NeDB matches its members.
  assert.deepEqual((await store.findAsync({ videoId: 'x' })).map(doc => doc._id).sort(), ['5', 'z'])
})

test('desktop databases run in a worker thread', async (t) => {
  const dir = await directory(t)
  await writeFile(join(dir, 'playlists.db'), lines([{ _id: 'p', playlistName: 'Legacy', videos: [video('a')] }]))
  const createDriver = createWorkerDrivers(new URL('../../src/datastores/sqliteNodeWorker.js', import.meta.url))
  const store = createDesktopDatastore(join(dir, 'playlists.sqlite'), join(dir, 'playlists.db'), { childField: 'videos', createDriver })
  t.after(() => store.driver.close())
  await store.updateAsync({ _id: 'p' }, { $push: { videos: video('b') } })
  assert.deepEqual(await store.findOneAsync({ _id: 'p' }), { _id: 'p', playlistName: 'Legacy', videos: [video('a'), video('b')] })
  await assert.rejects(store.driver.execute([['SELECT * FROM missing']]), /no such table/)
  await store.dropDatabaseAsync()
  assert.equal(existsSync(join(dir, 'playlists.sqlite')), false)
})

test('existing NeDB handler tests pass against SQLite', async () => {
  const files = [
    'history-unseen-marks', 'playlist-repair', 'profile-loading', 'recommendation-learning', 'playlist-loading',
    'recommendation-history-removal', 'setting-repair', 'subscription-cache-writes', 'subscription-history-atomic',
    'sync-seen-videos',
  ].map(name => `tests/unit/${name}.test.mjs`)
  await promisify(execFile)(process.execPath, ['--import', './tests/helpers/nedb-as-sqlite.mjs', '--test', ...files], { maxBuffer: 64 * 1024 * 1024 })
})

test('replaceManyAsync writes every document in one transaction', async (t) => {
  const store = memory(t)
  const transactions = []
  const execute = store.driver.execute
  store.driver = {
    ...store.driver,
    execute (statements, transaction) {
      if (transaction) transactions.push(statements.length)
      return execute(statements, transaction)
    }
  }
  await store.insertAsync({ _id: 'kept', videos: ['old'], shorts: ['short'] })
  transactions.length = 0
  await store.replaceManyAsync([
    { _id: 'kept', videos: ['new'], shorts: ['short'] },
    { _id: 'added', videos: ['first'] },
  ])
  assert.deepEqual(transactions, [2])
  assert.deepEqual(await store.findAsync({}).sort({ _id: 1 }), [
    { _id: 'added', videos: ['first'] },
    { _id: 'kept', videos: ['new'], shorts: ['short'] },
  ])
})

test('only the rebuildable subscription cache skips the disk sync of each commit', async (t) => {
  const dir = await directory(t)
  for (const [name, synchronous] of [['subscription-cache', 1], ['history', 2]]) {
    const driver = createNodeSqliteDriver(join(dir, `${name}.sqlite`))
    t.after(() => driver.close())
    assert.equal((await driver.execute([['PRAGMA synchronous']]))[0][0][0], synchronous, name)
  }
})
