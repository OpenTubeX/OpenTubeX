import Datastore from '@seald-io/nedb'

const options = {
  history: { indexes: ['videoId'] },
  playlists: { childField: 'videos' },
  'watch-stats': { indexes: ['date'] },
  'video-metadata-cache': { indexes: ['videoId'] },
}

const legacyChangeListeners = new Set()

/**
 * Called after an older version's writes to a legacy datastore were applied.
 * @param {(change: { name: string, changed: number, deleted: number, backup?: string }) => void} listener
 */
export function onLegacyDatastoreChanges(listener) {
  legacyChangeListeners.add(listener)
}

let dbPath = null
let createDatastore

if (process.env.IS_ELECTRON_MAIN) {
  const { app } = require('electron')
  const { join } = require('path')
  const { createDesktopDatastore } = require('./sqliteNode.js')
  const userDataPath = app.getPath('userData') // This is based on the user's OS
  dbPath = (dbName) => join(userDataPath, `${dbName}.db`)

  // Each NeDB file is imported on first use and left in place for older versions.
  createDatastore = (name) => createDesktopDatastore(join(userDataPath, `${name}.sqlite`), dbPath(name), {
    ...options[name],
    onLegacyChanges: change => legacyChangeListeners.forEach(listener => listener({ name, ...change })),
  })
} else {
  const { createBrowserDatastore } = require('./sqliteBrowser.js')
  dbPath = (dbName) => `${dbName}.db`
  createDatastore = (name) => createBrowserDatastore(name, options[name])
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

// The legacy browser cache stays in NeDB's own storage, read only to import it.
export function loadLegacySubscriptionCache() {
  return new Datastore({ filename: dbPath('subscription-cache'), autoload: true, corruptAlertThreshold: 1 }).findAsync({})
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
