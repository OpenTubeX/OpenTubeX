// Runs SQLite for the web build. OPFS synchronous access handles are only
// available in dedicated workers.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { SCHEMA_VERSION } from './sqliteSchemaVersion.js'

let lock = null
let pool = null
const databases = new Map()

/**
 * Holds an exclusive lock for this worker's lifetime. The pool opens every
 * file exclusively, so only one tab can use it; a reload waits briefly for the
 * previous worker to end instead of failing.
 */
function acquireLibraryLock() {
  return new Promise((resolve, reject) => {
    navigator.locks.request('opentubex-library', { signal: AbortSignal.timeout(5000) }, () => {
      resolve()
      return new Promise(() => {})
    }).catch(reject)
  })
}

async function getPool() {
  lock ??= acquireLibraryLock().catch(error => {
    lock = null
    throw error
  })
  pool ??= lock.then(() => sqlite3InitModule()).then(sqlite3 => sqlite3.installOpfsSAHPoolVfs({
    name: 'opentubex-library',
    directory: '/opentubex-library',
    initialCapacity: 32,
  })).catch(error => {
    pool = null
    // The pool keeps each file open, so a second tab cannot use it.
    throw new Error(`Unable to open the library. If OpenTubeX is open in another tab, close it and try again. (${error.message})`, { cause: error })
  })
  return pool
}

// One opening per library, so concurrent first calls share a connection.
function open(name) {
  if (!databases.has(name)) {
    const opening = openDatabase(name)
    opening.catch(() => databases.delete(name))
    databases.set(name, opening)
  }
  return databases.get(name)
}

async function openDatabase(name) {
  const { OpfsSAHPoolDb } = await getPool()
  const db = new OpfsSAHPoolDb(`/${name}.sqlite`)
  try {
    // Settings that change the file apply only to a database this version can
    // use, so a newer version's database stays untouched until it is refused.
    const version = db.selectValue('PRAGMA user_version')
    if (version === 0) {
      // Takes effect only before the first table exists, whose creation
      // commits and syncs the header, so skip this write's own sync.
      db.exec('PRAGMA synchronous = OFF')
      db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    }
    // This VFS has no shared memory, so it cannot use a write-ahead log.
    if (version <= SCHEMA_VERSION) db.exec('PRAGMA journal_mode = TRUNCATE')
    db.exec('PRAGMA synchronous = FULL')
  } catch (error) {
    db.close()
    throw error
  }
  db.statements = new Map()
  return db
}

function run(db, sql, params) {
  let statement = db.statements.get(sql)
  if (!statement) {
    statement = db.prepare(sql)
    db.statements.set(sql, statement)
  }
  try {
    if (params.length) statement.bind(params)
    const rows = []
    while (statement.step()) rows.push(statement.get([]))
    return rows
  } finally {
    statement.reset(true)
  }
}

const methods = {
  async execute({ name, statements, transaction }) {
    const db = await open(name)
    if (transaction) db.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map(([sql, params = []]) => run(db, sql, params))
      if (transaction) db.exec('COMMIT')
      return results
    } catch (error) {
      if (transaction) {
        try { db.exec('ROLLBACK') } catch {}
      }
      throw error
    }
  },
  async drop({ name }) {
    const db = await databases.get(name)?.catch(() => null)
    db?.statements.forEach(statement => statement.finalize())
    db?.close()
    databases.delete(name)
    // unlink() needs the pool as its receiver.
    const poolUtil = await getPool()
    for (const suffix of ['', '-journal']) poolUtil.unlink(`/${name}.sqlite${suffix}`)
  },
}

self.onmessage = async ({ data: { id, method, args } }) => {
  try {
    self.postMessage({ id, result: await methods[method](args) })
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? String(error) })
  }
}
