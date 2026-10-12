import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { LibraryEngine } from './engine.js'
import { SCHEMA_SQL } from './schema.js'

// A private, disposable copy of verified settings/session records lets the main
// process prepare windows during migration. It never grants live library access.
export class StartupLibrary {
  constructor() {
    this.context = new AsyncLocalStorage()
    this.available = Promise.withResolvers()
    this.available.promise.catch(() => {})
    this.readers = 0
  }

  publish(snapshot) {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
      const engine = new LibraryEngine(database)
      database.exec('BEGIN')
      for (const name of ['settings', 'tabSession']) {
        for (const record of snapshot[name]) engine.write(name, record)
      }
      database.exec('COMMIT; PRAGMA query_only = ON')
      this.snapshot = engine
      this.available.resolve(engine)
    } catch (error) {
      database.close()
      throw error
    }
  }

  activate(engine) {
    this.active = engine
    this.available.resolve(engine)
    this.closeSnapshot()
  }

  fail(error) {
    this.failure = error
    this.available.reject(error)
    this.closeSnapshot()
  }

  closeSnapshot() {
    if ((this.active || this.failure) && !this.readers && this.snapshot) {
      this.snapshot.database.close()
      this.snapshot = null
    }
  }

  async read(operation) {
    const available = await this.available.promise
    if (this.failure) throw this.failure
    const engine = this.active ?? available
    this.readers++
    try { return await this.context.run(engine, async () => await operation()) } finally {
      this.readers--
      this.closeSnapshot()
    }
  }

  assertWritable() {
    if (this.context.getStore()) throw new Error('Startup library snapshots are read-only')
  }
}
