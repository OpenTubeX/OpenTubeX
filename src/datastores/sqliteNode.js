import { createHash } from 'node:crypto'
import { createReadStream, existsSync, rmSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import Datastore from '@seald-io/nedb'
import { SqliteDatastore } from './sqlite.js'

/**
 * Electron's built-in SQLite. Statements run synchronously in the main
 * process, so every batch is a single uninterrupted step.
 * @param {string} filename
 * @returns {import('./sqlite.js').SqliteDriver}
 */
export function createNodeSqliteDriver(filename) {
  let db = null
  const statements = new Map()

  function open() {
    if (db) return db
    db = new DatabaseSync(filename)
    db.exec('PRAGMA busy_timeout = 5000')
    // Takes effect only before the first table exists. Compaction can then
    // release free pages without rewriting the whole database.
    db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
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
      const target = `${filename}.backup-${Date.now()}`
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

/**
 * A desktop NeDB datafile. It is only read, never modified, so an older
 * version keeps working with it; its size and modification time show when an
 * older version has written to it since.
 * @param {string} filename
 * @returns {import('./sqlite.js').LegacySource}
 */
export function createNedbFileSource(filename) {
  // NeDB recovers its temporary file only when the main file is missing.
  const source = () => [filename, `${filename}~`].find(path => existsSync(path))
  return {
    async read() {
      const path = source()
      if (!path) return { data: [], indexes: [] }
      const loader = new Datastore({ inMemoryOnly: true, corruptAlertThreshold: 1 })
      const { data, indexes } = await loader.persistence.treatRawStreamAsync(createReadStream(path, { encoding: 'utf8' }))
      return { data, indexes: Object.keys(indexes) }
    },
    async fingerprint() {
      const path = source()
      if (!path) return null
      const { size, mtimeMs } = statSync(path)
      return JSON.stringify([path === filename ? 'db' : 'db~', size, mtimeMs])
    },
    hash: text => createHash('sha256').update(text).digest('base64'),
    async remove() {
      rmSync(filename, { force: true })
      rmSync(`${filename}~`, { force: true })
    },
  }
}

/**
 * @param {string} filename SQLite file
 * @param {string} legacyFilename NeDB file it replaces
 * @param {Omit<ConstructorParameters<typeof SqliteDatastore>[0], 'driver' | 'legacy'>} [options]
 */
export function createDesktopDatastore(filename, legacyFilename, options = {}) {
  return new SqliteDatastore({
    driver: createNodeSqliteDriver(filename),
    legacy: legacyFilename ? createNedbFileSource(legacyFilename) : undefined,
    ...options,
  })
}
