import { workerData } from 'node:worker_threads'
import { openLibrary } from './migration.js'
import { createDeferredCursor } from './cursor.js'
import { StartupLibrary } from './startup.js'

let library
const startup = new StartupLibrary()
export function getLibrary() {
  const snapshot = startup.context.getStore()
  if (snapshot) return Promise.resolve(snapshot)
  library ??= openLibrary(workerData.directory, { onStartupReady: snapshot => startup.publish(snapshot) }).then(engine => {
    startup.activate(engine)
    return engine
  }, error => {
    startup.fail(error)
    throw error
  })
  return library
}

export function readStartupLibrary(operation) {
  getLibrary().catch(() => {})
  return startup.read(operation)
}

export function localCollection(name) {
  const collection = async () => {
    if (startup.context.getStore() && !['settings', 'tabSession'].includes(name)) throw new Error('This collection is unavailable in a startup snapshot')
    return (await getLibrary()).collections[name]
  }
  return {
    findAsync(query = {}, projection) {
      return createDeferredCursor(options => collection().then(store => {
        const result = store.findAsync(query, projection).sort(options.sort).skip(options.skip)
        if (options.limit !== null) result.limit(options.limit)
        return result
      }))
    },
    ...Object.fromEntries(['findOneAsync', 'countAsync', 'insertAsync', 'updateAsync', 'removeAsync'].map(method => [method, async (...args) => {
      if (['insertAsync', 'updateAsync', 'removeAsync'].includes(method)) startup.assertWritable()
      return (await collection())[method](...args)
    }])),
    loadDatabaseAsync: () => getLibrary().then(() => {}),
    ensureIndexAsync: () => Promise.resolve(),
    compactDatafileAsync: () => Promise.resolve(),
  }
}
