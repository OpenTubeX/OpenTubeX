import { access, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { COLLECTIONS } from '../../src/datastores/sqlite/schema.js'

/** Inspect active persistence; retained NeDB files are migration snapshots. */
export async function readPersistedDatastore(file, encoding) {
  const name = basename(file, '.db')
  const collection = Object.keys(COLLECTIONS).find(key => COLLECTIONS[key] === name)
  if (!collection) return readFile(file, encoding)
  const path = join(dirname(file), 'library.sqlite')
  try { await access(path) } catch (error) { if (error.code === 'ENOENT') return readFile(file, encoding); throw error }
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const engine = new LibraryEngine(database)
    const records = await engine.collections[collection].findAsync({})
    const text = records.map(model.serialize).join('\n') + '\n'
    return encoding ? text : Buffer.from(text)
  } finally { database.close() }
}
