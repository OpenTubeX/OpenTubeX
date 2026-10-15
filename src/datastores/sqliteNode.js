import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import Datastore from '@seald-io/nedb'
import { SqliteDatastore } from './sqlite.js'
import { createNodeSqliteDriver } from './sqliteNodeDriver.js'

export { createNodeSqliteDriver }

/**
 * Runs every desktop database in one worker thread, so slow disk syncs never
 * block the main process, which also handles windows and menus.
 * @param {string | URL} workerPath the bundled sqliteNodeWorker.js
 * @returns {(filename: string, backupDirectory?: string) => import('./sqlite.js').SqliteDriver}
 */
export function createWorkerDrivers(workerPath) {
  let worker = null
  let nextId = 0
  const pending = new Map()

  function fail(error) {
    worker = null
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  function call(message) {
    if (!worker) {
      worker = new Worker(workerPath)
      worker.on('message', ({ id, result, error }) => {
        const request = pending.get(id)
        pending.delete(id)
        if (error === undefined) request.resolve(result)
        else request.reject(Object.assign(new Error(error.message), { code: error.code }))
      })
      worker.on('error', fail)
      worker.on('exit', code => fail(new Error(`Library worker exited with code ${code}`)))
      // After the listeners, which would reference it again. Quitting waits
      // for pending writes through each datastore's queue instead.
      worker.unref()
    }
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, ...message })
    })
  }

  return (filename, backupDirectory) => {
    const target = { filename, backupDirectory }
    return {
      execute: (statements, transaction = false) => call({ ...target, method: 'execute', statements, transaction }),
      backup: () => call({ ...target, method: 'backup' }),
      drop: () => call({ ...target, method: 'drop' }),
      close: () => call({ ...target, method: 'close' }),
    }
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
 * Where a datastore and its legacy NeDB file live. A legacy file that is a
 * symbolic link, for example to another drive, keeps the library at its target.
 * @param {string} directory profile directory
 * @param {string} name
 */
export function desktopDatastorePaths(directory, name) {
  let legacy = join(directory, `${name}.db`)
  if (lstatSync(legacy, { throwIfNoEntry: false })?.isSymbolicLink()) {
    // A dangling link, for example after clearing a linked cache, points to
    // where its target was; that location simply has nothing to import.
    legacy = existsSync(legacy) ? realpathSync(legacy) : resolve(dirname(legacy), readlinkSync(legacy))
    return { legacy, filename: join(dirname(legacy), `${basename(legacy, '.db')}.sqlite`) }
  }
  return { legacy, filename: join(directory, `${name}.sqlite`) }
}

/**
 * @param {string} filename SQLite file
 * @param {string} legacyFilename NeDB file it replaces
 * @param {Omit<ConstructorParameters<typeof SqliteDatastore>[0], 'driver' | 'legacy'> & { backupDirectory?: string, createDriver?: ReturnType<typeof createWorkerDrivers> }} [options]
 */
export function createDesktopDatastore(filename, legacyFilename, { backupDirectory, createDriver = createNodeSqliteDriver, ...options } = {}) {
  return new SqliteDatastore({
    driver: createDriver(filename, backupDirectory),
    legacy: legacyFilename ? createNedbFileSource(legacyFilename) : undefined,
    ...options,
  })
}
