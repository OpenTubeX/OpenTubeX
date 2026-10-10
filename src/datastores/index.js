import Datastore from '@seald-io/nedb'

let dbPath = null
let createWorkerCollection

if (process.env.IS_ELECTRON_MAIN) {
  const { isMainThread } = require('node:worker_threads')
  if (isMainThread) {
    const { app } = require('electron')
    const { join } = require('path')
    // this code only runs in the electron main process, so hopefully using sync fs code here should be fine 😬
    const { statSync, realpathSync } = require('fs')
    const userDataPath = app.getPath('userData') // This is based on the user's OS
    dbPath = (dbName) => {
      let path = join(userDataPath, `${dbName}.db`)

      // returns undefined if the path doesn't exist
      if (statSync(path, { throwIfNoEntry: false })?.isSymbolicLink) {
        path = realpathSync(path)
      }

      return path
    }
  } else {
    const { COLLECTIONS } = require('./sqlite/schema.js')
    const { localCollection } = require('./sqlite/instance.js')
    createWorkerCollection = name => localCollection(Object.keys(COLLECTIONS).find(key => COLLECTIONS[key] === name))
  }
} else {
  dbPath = (dbName) => `${dbName}.db`
}

/**
 * @param {string} name
 */
function createDatastore(name) {
  if (createWorkerCollection) return createWorkerCollection(name)
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

  // Background refreshes append whole channel records. Compact during long
  // sessions so an interrupted shutdown cannot leave gigabytes to replay.
  if (process.env.IS_ELECTRON_MAIN && name === 'subscription-cache') {
    let compactionInProgress = false
    setInterval(() => {
      if (compactionInProgress) return
      compactionInProgress = true
      datastore.compactDatafileAsync().catch(error => {
        console.error('Failed to compact subscription cache:', error)
      }).finally(() => {
        compactionInProgress = false
      })
    }, 5 * 60 * 1000).unref()
  }

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
