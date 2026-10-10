import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { readPersistedDatastore } from '../../e2e/helpers/datastore.mjs'

async function profile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-persistence-reader-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('reading a released profile preserves the complete NeDB log without activating SQLite', async t => {
  const directory = await profile(t)
  const path = join(directory, 'history.db')
  const log = '{"_id":"video","title":"old"}\n{"_id":"video","$$deleted":true}\n'
  await writeFile(path, log)
  assert.equal(await readPersistedDatastore(path, 'utf8'), log)
  assert.deepEqual(await readPersistedDatastore(path), Buffer.from(log))
  assert.deepEqual(await readdir(directory), ['history.db'])
})

test('reading an activated profile uses current SQLite records and retains migration originals', async t => {
  const directory = await profile(t)
  const path = join(directory, 'playlists.db')
  const original = '{"_id":"old-original","videos":[]}\n'
  await writeFile(path, original)
  const database = new DatabaseSync(join(directory, 'library.sqlite'))
  t.after(() => database.close())
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
  const directory = await profile(t)
  const path = join(directory, 'downloads.json')
  const contents = '[{"title":"Download"}]'
  await writeFile(path, contents)
  assert.equal(await readPersistedDatastore(path, 'utf8'), contents)
})
