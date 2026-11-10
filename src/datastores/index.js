// @ts-check
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

const legacyImportListeners = new Set()

/**
 * Called after an existing legacy datastore was imported, once per datastore.
 * @param {(imported: { name: string, documents: number }) => void} listener
 */
export function onLegacyDatastoreImported(listener) {
  legacyImportListeners.add(listener)
}

/** @type {(dbName: string) => string} */
let dbPath
let createDatastore

if (process.env.IS_ELECTRON_MAIN) {
  const { app } = require('electron')
  const { join, resolve } = require('path')
  const { createDesktopDatastore, createWorkerDrivers, desktopDatastorePaths } = require('./sqliteNode.js')
  const userDataPath = app.getPath('userData') // This is based on the user's OS
  // Disk syncs run in a worker thread, so they never stall windows and menus.
  // Development builds set __dirname to this source directory and emit to dist.
  const createDriver = createWorkerDrivers(process.env.NODE_ENV === 'development'
    ? resolve(__dirname, '../../dist/sqliteNodeWorker.js')
    : join(__dirname, 'sqliteNodeWorker.js'))
  dbPath = (dbName) => desktopDatastorePaths(userDataPath, dbName).legacy

  // Each NeDB file is imported on first use and left in place for older versions.
  createDatastore = (name) => {
    const { filename, legacy } = desktopDatastorePaths(userDataPath, name)
    return createDesktopDatastore(filename, legacy, {
      ...options[name],
      // The notice about older versions' changes points to the profile folder.
      backupDirectory: userDataPath,
      createDriver,
      onLegacyChanges: change => legacyChangeListeners.forEach(listener => listener({ name, ...change })),
      onLegacyImported: imported => legacyImportListeners.forEach(listener => listener({ name, ...imported })),
    })
  }
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
