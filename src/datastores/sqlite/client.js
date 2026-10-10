import { Worker } from 'node:worker_threads'
import { join, resolve } from 'node:path'
import { SyncServerDataLossError } from '../../renderer/helpers/sync-server-errors.js'
import { app } from 'electron'
import { createDeferredCursor } from './cursor.js'

let worker
let failure
let sequence = 0
const pending = new Map()

export function libraryRequest(target, method, args = []) {
  if (failure) return Promise.reject(failure)
  if (!worker) {
    worker = new Worker(process.env.NODE_ENV === 'development' ? resolve(__dirname, '../../../dist/libraryWorker.js') : join(__dirname, 'libraryWorker.js'), {
      workerData: { directory: app.getPath('userData') }
    })
    worker.unref()
    const failed = error => {
      failure ??= error
      for (const request of pending.values()) request.reject(failure)
      pending.clear()
    }
    worker.on('error', failed)
    worker.on('exit', code => failed(new Error(`The library worker stopped (${code}); restart the app before retrying writes`)))
    worker.on('message', ({ id, result, error }) => {
      const request = pending.get(id)
      if (!request) return
      pending.delete(id)
      if (error) request.reject(error.name === 'SyncServerDataLossError' ? new SyncServerDataLossError(error.collection, error.deleted, error.previous, error.items) : Object.assign(new Error(error.message), { code: error.code, locale: error.locale, useAITranslationCompletions: error.useAITranslationCompletions }))
      else request.resolve(result)
    })
  }
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try { worker.postMessage({ id, target, method, args }) } catch (error) { pending.delete(id); reject(error) }
  })
}

export function remoteCollection(name, request = libraryRequest) {
  return {
    findAsync(query = {}, projection) {
      return createDeferredCursor(options => request(`collection:${name}`, 'find', [query, projection, options]))
    },
    findOneAsync: (...args) => request(`collection:${name}`, 'findOneAsync', args),
    countAsync: (...args) => request(`collection:${name}`, 'countAsync', args),
    insertAsync: (...args) => request(`collection:${name}`, 'insertAsync', args),
    updateAsync: (...args) => request(`collection:${name}`, 'updateAsync', args),
    removeAsync: (...args) => request(`collection:${name}`, 'removeAsync', args),
    loadDatabaseAsync: () => request('engine', 'initialize'),
    ensureIndexAsync: () => Promise.resolve(),
    compactDatafileAsync: () => request('engine', 'checkpoint'),
  }
}
