import Datastore from '@seald-io/nedb'

let dbPath = null
let createElectronCollection

if (process.env.IS_ELECTRON_MAIN) {
  const { isMainThread } = require('node:worker_threads')
  const { COLLECTIONS } = require('./sqlite/schema.js')
  const create = isMainThread ? require('./sqlite/client.js').remoteCollection : require('./sqlite/instance.js').localCollection
  createElectronCollection = name => create(Object.keys(COLLECTIONS).find(key => COLLECTIONS[key] === name))
} else {
  dbPath = (dbName) => `${dbName}.db`
}

/**
 * @param {string} name
 */
function createDatastore(name) {
  if (process.env.IS_ELECTRON_MAIN) return createElectronCollection(name)
  const datastore = new Datastore({
    filename: dbPath(name),
    autoload: !process.env.IS_ELECTRON_MAIN,
    // Android's startup gate presents a recoverable error instead of an
    // unhandled autoload rejection or an apparently empty installation.
    onload: process.env.IS_CAPACITOR && !process.env.IS_IOS
      ? error => { if (error) console.error('Unable to load app datastore:', name, error) }
      : undefined,
    // Automatically clean up corrupted data, instead of crashing
    corruptAlertThreshold: 1
  })

  return datastore
}

export const settings = createDatastore('settings')
export const profiles = createDatastore('profiles')
export const playlists = createDatastore('playlists')
export const history = createDatastore('history')
export const watchStats = createDatastore('watch-stats')
export const recommendations = createDatastore('recommendations')
export const searchHistory = createDatastore('search-history')
// Web/Android use channel records in IndexedDB. Load the old NeDB cache only
// when importing an existing installation, not on every application startup.
export const subscriptionCache = process.env.IS_ELECTRON_MAIN ? createDatastore('subscription-cache') : null

export function loadLegacySubscriptionCache() {
  return createDatastore('subscription-cache').findAsync({})
}

export function removeLegacySubscriptionCache() {
  return new Datastore({ filename: dbPath('subscription-cache') }).dropDatabaseAsync()
}
export const tabSession = createDatastore('tab-session')
export const liveReminders = createDatastore('live-reminders')
export const videoMetadataCache = createDatastore('video-metadata-cache')

export async function waitForDatastores() {
  const results = await Promise.allSettled([
    settings, profiles, playlists, history, watchStats, recommendations,
    searchHistory, tabSession, liveReminders, videoMetadataCache,
  ].map(datastore => datastore.autoloadPromise))
  const failure = results.find(result => result.status === 'rejected')
  if (failure) throw failure.reason
}
