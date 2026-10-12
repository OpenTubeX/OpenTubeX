import { access, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { COLLECTIONS } from '../../src/datastores/sqlite/schema.js'

async function activeLibraryFor(file) {
  const name = basename(file, '.db')
  const collection = Object.keys(COLLECTIONS).find(key => COLLECTIONS[key] === name)
  if (!collection) return null
  const path = join(dirname(file), 'library.sqlite')
  try { await access(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  return { collection, path }
}

/** Inspect active persistence; retained NeDB files are migration snapshots. */
export async function readPersistedDatastore(file, encoding) {
  const library = await activeLibraryFor(file)
  if (!library) return readFile(file, encoding)
  const { collection, path } = library
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const engine = new LibraryEngine(database)
    // Metadata, normalized members and blobs must share one WAL snapshot.
    database.exec('BEGIN')
    const records = await engine.collections[collection].findAsync({})
    const text = records.map(model.serialize).join('\n') + '\n'
    return encoding ? text : Buffer.from(text)
  } finally { database.close() }
}

/** Observe durable writes even when a rewrite leaves the logical rows unchanged. */
export async function readPersistedDatastoreWriteState(file) {
  const library = await activeLibraryFor(file)
  if (!library) {
    const log = (await readFile(file, 'utf8')).trim()
    return { format: 'nedb', lines: log ? log.split('\n').length : 0 }
  }
  const { collection, path } = library
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    return { format: 'sqlite', revision: database.prepare('SELECT revision FROM revisions WHERE collection = ?').get(collection)?.revision ?? 0 }
  } finally { database.close() }
}
