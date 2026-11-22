import { parseLegacyDatafile, SqliteDatastore } from './sqlite.js'
import { claimLibrary, whenLibraryAvailable } from './libraryHandover.js'

/**
 * @param {() => Worker} startWorker
 * @returns {(name: string) => import('./sqlite.js').SqliteDriver}
 */
function workerDrivers(startWorker) {
  let worker = null
  /** @type {object[] | null} Requests waiting for this tab to start the worker */
  let queued = null
  let nextId = 0
  const pending = new Map()
  /** @type {(() => void)[]} */
  const idleWaiters = []

  function settle(id, settleRequest) {
    const request = pending.get(id)
    pending.delete(id)
    settleRequest(request)
    if (!pending.size) idleWaiters.splice(0).forEach(resolve => resolve())
  }

  // Lets the datastore operations this tab started finish, then ends the worker,
  // which closes the library and releases its lock for the tab that takes it over.
  async function release() {
    const timedOut = new Promise(resolve => setTimeout(() => resolve(true), 3000))
    // The writes that saving starts can take a few steps to arrive here.
    await new Promise(resolve => setTimeout(resolve, 100))
    // An operation sends its next request after the reply to the previous one.
    // Message tasks aren't throttled in background tabs like timers.
    while (pending.size) {
      if (await Promise.race([new Promise(resolve => idleWaiters.push(() => resolve(false))), timedOut])) break
      await new Promise(resolve => {
        const { port1, port2 } = new MessageChannel()
        port1.onmessage = resolve
        port2.postMessage(null)
      })
    }
    worker?.terminate()
    worker = null
  }

  function start() {
    worker = startWorker()
    claimLibrary(release)
    worker.onmessage = ({ data: { id, result, error } }) => {
      settle(id, request => error === undefined ? request.resolve(result) : request.reject(new Error(error)))
    }
    // A worker that fails to load or crashes never answers. Fail its
    // requests, and start a new worker for the next one.
    worker.onerror = worker.onmessageerror = event => {
      event.preventDefault?.()
      worker.terminate()
      worker = null
      const error = new Error(`Library worker failed: ${event.message ?? event.type}`)
      for (const id of [...pending.keys()]) settle(id, request => request.reject(error))
    }
  }

  // Requests wait while another tab has the library, in the order they were made.
  function post(message) {
    if (worker) {
      worker.postMessage(message)
    } else if (queued) {
      queued.push(message)
    } else {
      queued = [message]
      whenLibraryAvailable().then(() => {
        const requests = queued
        queued = null
        try {
          start()
          for (const request of requests) worker.postMessage(request)
        } catch (error) {
          worker?.terminate()
          worker = null
          for (const { id } of requests) settle(id, request => request.reject(error))
        }
      })
    }
  }

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      post({ id, method, args })
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
// the library stays outside WebView storage. Starting the worker only in the
// other branch keeps SQLite's WebAssembly out of their bundles.
const createDriver = process.env.IS_CAPACITOR
  ? nativeDrivers()
  : workerDrivers(() => new Worker(new URL('./sqliteWorker.js', import.meta.url), { type: 'module' }))

// The adapter that stored each platform's NeDB files. Capacitor builds
// replace only NeDB's own relative import of it, so choose it explicitly.
const legacyStorage = process.env.IS_CAPACITOR ? require('./androidStorage.js') : require('@seald-io/nedb/lib/storage.js')

/**
 * The NeDB datastore this database replaces. It stays in place and is only
 * read, apart from removing secrets in the apps.
 * @param {string} filename
 * @returns {import('./sqlite.js').LegacySource}
 */
function legacySource(filename) {
  const read = async () => parseLegacyDatafile(await legacyStorage.readFileAsync(filename))
  return {
    read,
    // The apps keep one record per document, which a deletion removes.
    // Android also keeps the WebView storage it was imported from.
    ...(process.env.IS_CAPACITOR && {
      async records() {
        const retained = (await legacyStorage.readRetainedAsync?.(filename) ?? '').split('\n').flatMap(line => {
          try {
            const record = JSON.parse(line)
            return record !== null && typeof record === 'object' && '_id' in record ? [record] : []
          } catch {
            return []
          }
        })
        return [...(await read()).data, ...retained]
      },
      async removeDocuments(ids) {
        await legacyStorage.removeDocumentsAsync(filename, ids)
        return true
      },
    }),
  }
}

/**
 * @param {string} name
 * @param {object} [options]
 * @param {boolean} [options.legacy] false for a datastore no NeDB version ever stored
 */
export function createBrowserDatastore(name, { legacy = true, ...options } = {}) {
  return new SqliteDatastore({ driver: createDriver(name), legacy: legacy ? legacySource(`${name}.db`) : undefined, ...options })
}
