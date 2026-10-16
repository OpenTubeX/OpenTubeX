import { rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Electron's built-in SQLite. Statements run synchronously, so every batch is
 * a single uninterrupted step. The app runs this in sqliteNodeWorker.js.
 * @param {string} filename
 * @param {string} [backupDirectory] where backups go, beside the database by default
 * @returns {import('./sqlite.js').SqliteDriver}
 */
export function createNodeSqliteDriver(filename, backupDirectory = dirname(filename)) {
  let db = null
  const statements = new Map()

  function open() {
    if (db) return db
    db = new DatabaseSync(filename)
    db.exec('PRAGMA busy_timeout = 5000')
    // Persistent settings apply only to a database this version is creating,
    // so a newer version's database stays untouched until its schema is checked.
    if (db.prepare('PRAGMA user_version').get().user_version === 0) {
      // Takes effect only before the first table exists. Compaction can then
      // release free pages without rewriting the whole database. Each sync is
      // slow on a busy disk, so this header write skips its own: switching to
      // the write-ahead log rewrites and syncs the header.
      db.exec('PRAGMA synchronous = OFF')
      db.exec('PRAGMA auto_vacuum = INCREMENTAL')
      db.exec('PRAGMA synchronous = FULL')
      if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
    }
    // Every committed write survives power loss.
    db.exec('PRAGMA synchronous = FULL')
    return db
  }

  function prepare(sql) {
    let statement = statements.get(sql)
    if (!statement) {
      statement = open().prepare(sql)
      // Row objects cost several times more to create than parsing their JSON.
      statement.setReturnArrays(true)
      statements.set(sql, statement)
    }
    return statement
  }

  function close() {
    db?.close()
    db = null
    statements.clear()
  }

  return {
    async execute(list, transaction = false) {
      open()
      if (transaction) db.exec('BEGIN IMMEDIATE')
      try {
        const results = list.map(([sql, params = []]) => prepare(sql).all(...params))
        if (transaction) db.exec('COMMIT')
        return results
      } catch (error) {
        if (transaction && db.isTransaction) db.exec('ROLLBACK')
        throw error
      }
    },
    async backup() {
      const target = join(backupDirectory, `${basename(filename)}.backup-${Date.now()}`)
      open().exec(`VACUUM INTO '${target.replaceAll('\'', '\'\'')}'`)
      return target
    },
    async drop() {
      close()
      for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(filename + suffix, { force: true })
    },
    close,
  }
}
