import { parseLegacyDatafile, SqliteDatastore } from './sqlite.js'

/** @returns {(name: string) => import('./sqlite.js').SqliteDriver} */
function workerDrivers() {
  let worker = null
  let nextId = 0
  const pending = new Map()
  function call(method, args) {
    if (!worker) {
      worker = new Worker(new URL('./sqliteWorker.js', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data: { id, result, error } }) => {
        const request = pending.get(id)
        pending.delete(id)
        if (error === undefined) request.resolve(result)
        else request.reject(new Error(error))
      }
      // A worker that fails to load or crashes never answers. Fail its
      // requests, and start a new worker for the next one.
      worker.onerror = worker.onmessageerror = event => {
        event.preventDefault?.()
        worker.terminate()
        worker = null
        const error = new Error(`Library worker failed: ${event.message ?? event.type}`)
        for (const request of pending.values()) request.reject(error)
        pending.clear()
      }
    }
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, method, args })
    })
  }
  return name => ({
    execute: (statements, transaction = false) => call('execute', { name, statements, transaction }),
    drop: () => call('drop', { name }),
  })
}

/** @returns {(name: string) => import('./sqlite.js').SqliteDriver} */
function nativeDrivers() {
  const { Capacitor, registerPlugin } = require('@capacitor/core')
  const plugin = registerPlugin('LibraryDatabase')
  // Android writes large reads to a file: fetching it from the local server
  // is an order of magnitude faster than one multi-megabyte bridge message.
  const read = name => async (sql, params = []) => {
    const { path } = await plugin.query({ name, sql, params })
    try {
      const response = await fetch(Capacitor.convertFileSrc(path))
      if (!response.ok) throw new Error(`Unable to read library results: ${response.status}`)
      return await response.json()
    } finally {
      plugin.release({ path }).catch(() => {})
    }
  }
  return name => ({
    execute: async (statements, transaction = false) => (await plugin.execute({ name, statements, transaction })).results,
    ...(process.env.IS_IOS ? {} : { read: read(name) }),
    drop: () => plugin.drop({ name }),
  })
}

// Android and iOS use the system's native SQLite through an app plugin, so
// the library stays outside WebView storage.
const createDriver = process.env.IS_CAPACITOR ? nativeDrivers() : workerDrivers()

// The adapter that stored each platform's NeDB files. Capacitor builds
// replace only NeDB's own relative import of it, so choose it explicitly.
const legacyStorage = process.env.IS_CAPACITOR ? require('./androidStorage.js') : require('@seald-io/nedb/lib/storage.js')

/**
 * The NeDB datastore this database replaces. It is only read and stays in place.
 * @param {string} filename
 * @returns {import('./sqlite.js').LegacySource}
 */
function legacySource(filename) {
  return {
    read: async () => parseLegacyDatafile(await legacyStorage.readFileAsync(filename)),
  }
}

/**
 * @param {string} name
 * @param {object} [options]
 */
export function createBrowserDatastore(name, options = {}) {
  return new SqliteDatastore({ driver: createDriver(name), legacy: legacySource(`${name}.db`), ...options })
}
