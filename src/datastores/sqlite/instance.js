import { workerData } from 'node:worker_threads'
import { openLibrary } from './migration.js'
import { createDeferredCursor } from './cursor.js'

let library
export function getLibrary() {
  library ??= openLibrary(workerData.directory)
  return library
}

export function localCollection(name) {
  return {
    findAsync(query = {}, projection) {
      return createDeferredCursor(options => getLibrary().then(engine => {
        const result = engine.collections[name].findAsync(query, projection).sort(options.sort).skip(options.skip)
        if (options.limit !== null) result.limit(options.limit)
        return result
      }))
    },
    ...Object.fromEntries(['findOneAsync', 'countAsync', 'insertAsync', 'updateAsync', 'removeAsync'].map(method => [method, async (...args) => (await getLibrary()).collections[name][method](...args)])),
    loadDatabaseAsync: () => getLibrary().then(() => {}),
    ensureIndexAsync: () => Promise.resolve(),
    compactDatafileAsync: () => Promise.resolve(),
  }
}
