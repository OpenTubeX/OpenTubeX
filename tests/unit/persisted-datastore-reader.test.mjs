import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { COLLECTIONS, SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { readPersistedDatastore, readPersistedDatastoreWriteState } from '../../e2e/helpers/datastore.mjs'

async function profile(t, sqlite = false) {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-persistence-reader-'))
  let database
  t.after(async () => {
    database?.close()
    await rm(directory, { recursive: true, force: true })
  })
  if (sqlite) database = new DatabaseSync(join(directory, 'library.sqlite'))
  return { directory, database }
}

test('reading a released profile preserves the complete NeDB log without activating SQLite', async t => {
  const { directory } = await profile(t)
  const path = join(directory, 'history.db')
  const log = '{"_id":"video","title":"old"}\n{"_id":"video","$$deleted":true}\n'
  await writeFile(path, log)
  assert.equal(await readPersistedDatastore(path, 'utf8'), log)
  assert.deepEqual(await readPersistedDatastore(path), Buffer.from(log))
  assert.deepEqual(await readdir(directory), ['history.db'])
})

test('reading an activated profile uses current SQLite records and retains migration originals', async t => {
  const { directory, database } = await profile(t, true)
  const path = join(directory, 'playlists.db')
  const original = '{"_id":"old-original","videos":[]}\n'
  await writeFile(path, original)
  database.exec(SCHEMA_SQL)
  const engine = new LibraryEngine(database)
  const playlist = {
    _id: 'current', title: 'Current playlist', customDate: new Date('2020-01-01T00:00:00Z'),
    videos: [{ videoId: 'duplicate', custom: 'first' }, { videoId: 'duplicate', custom: 'second' }],
  }
  await engine.collections.playlists.insertAsync(playlist)
  const text = await readPersistedDatastore(path, 'utf8')
  assert.deepEqual(text.trim().split('\n').map(model.deserialize), [playlist])
  assert.deepEqual(await readPersistedDatastore(path), Buffer.from(text))
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual(await engine.collections.playlists.findAsync({}), [playlist])
})

test('files outside the library collections remain ordinary files', async t => {
  const { directory } = await profile(t)
  const path = join(directory, 'downloads.json')
  const contents = '[{"title":"Download"}]'
  await writeFile(path, contents)
  assert.equal(await readPersistedDatastore(path, 'utf8'), contents)
})

for (const collection of ['playlists', 'subscriptionCache', 'videoMetadataCache']) {
  test(`reading ${collection} keeps one snapshot across a concurrent normalized-record commit`, async t => {
    const { directory, database } = await profile(t, true)
    database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
    database.exec(SCHEMA_SQL)
    const writer = new LibraryEngine(database)
    const original = {
      _id: 'record', title: 'Before', unknown: { date: new Date(123) },
      ...(collection === 'videoMetadataCache' ? { thumbnail: 'old thumbnail' } : { videos: [{ videoId: 'old' }] }),
    }
    const updated = {
      ...original, title: 'After',
      ...(collection === 'videoMetadataCache' ? { thumbnail: 'new thumbnail' } : { videos: [{ videoId: 'new' }] }),
    }
    await writer.collections[collection].insertAsync(original)
    let committed = false
    const materialize = LibraryEngine.prototype.materialize
    t.mock.method(LibraryEngine.prototype, 'materialize', function (...args) {
      if (this.database !== database && !committed) {
        database.exec('BEGIN IMMEDIATE')
        try { writer.write(collection, updated, true); writer.touch(collection); database.exec('COMMIT') }
        catch (error) { database.exec('ROLLBACK'); throw error }
        committed = true
      }
      return Reflect.apply(materialize, this, args)
    })
    const path = join(directory, COLLECTIONS[collection] + '.db')
    const read = async () => (await readPersistedDatastore(path, 'utf8')).trim().split('\n').map(model.deserialize)
    assert.deepEqual(await read(), [original])
    assert.equal(committed, true)
    assert.deepEqual(await read(), [updated])
  })
}

test('the rewrite signal detects unchanged SQLite writes and ignores rolled-back changes', async t => {
  const { directory, database } = await profile(t, true)
  const path = join(directory, 'history.db')
  database.exec(SCHEMA_SQL)
  const engine = new LibraryEngine(database)
  const record = { _id: 'same', videoId: 'same', title: 'Unchanged', timeWatched: 1 }
  await engine.collections.history.insertAsync(record)
  const logical = await readPersistedDatastore(path, 'utf8')
  const before = await readPersistedDatastoreWriteState(path)
  await engine.collections.history.updateAsync({ _id: record._id }, { $set: { title: record.title } })
  assert.equal(await readPersistedDatastore(path, 'utf8'), logical)
  assert.notDeepEqual(await readPersistedDatastoreWriteState(path), before)
  const committed = await readPersistedDatastoreWriteState(path)
  await assert.rejects(engine.transaction(async () => {
    await engine.collections.history.updateAsync({ _id: record._id }, { $set: { title: 'Rolled back' } })
    throw new Error('abort')
  }), /abort/)
  assert.deepEqual(await readPersistedDatastoreWriteState(path), committed)
})

test('the rewrite signal detects unchanged NeDB append-log writes without activating SQLite', async t => {
  const { directory } = await profile(t)
  const path = join(directory, 'history.db')
  const record = '{"_id":"same","title":"Unchanged"}\n'
  await writeFile(path, record)
  const before = await readPersistedDatastoreWriteState(path)
  await writeFile(path, record + record)
  assert.notDeepEqual(await readPersistedDatastoreWriteState(path), before)
  assert.deepEqual(await readdir(directory), ['history.db'])
})

for (const empty of ['', '\n\n  \n']) {
  test(`the rewrite signal counts an empty NeDB log as zero before the first write: ${JSON.stringify(empty)}`, async t => {
    const { directory } = await profile(t)
    const path = join(directory, 'history.db')
    await writeFile(path, empty)
    assert.deepEqual(await readPersistedDatastoreWriteState(path), { format: 'nedb', lines: 0 })
    await writeFile(path, '{"_id":"first","title":"First write"}\n')
    assert.deepEqual(await readPersistedDatastoreWriteState(path), { format: 'nedb', lines: 1 })
    assert.deepEqual(await readdir(directory), ['history.db'])
  })
}
