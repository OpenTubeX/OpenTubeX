// Runs SQLite for the web build. OPFS synchronous access handles are only
// available in dedicated workers.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

let pool = null
const databases = new Map()

async function getPool() {
  pool ??= sqlite3InitModule().then(sqlite3 => sqlite3.installOpfsSAHPoolVfs({
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
    // Takes effect only before the first table exists, whose creation
    // commits and syncs the header, so skip this write's own sync.
    db.exec('PRAGMA synchronous = OFF')
    db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    // This VFS has no shared memory, so it cannot use a write-ahead log.
    db.exec('PRAGMA journal_mode = TRUNCATE')
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
    const { unlink } = await getPool()
    for (const suffix of ['', '-journal']) unlink(`/${name}.sqlite${suffix}`)
  },
}

self.onmessage = async ({ data: { id, method, args } }) => {
  try {
    self.postMessage({ id, result: await methods[method](args) })
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? String(error) })
  }
}
