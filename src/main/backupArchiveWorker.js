import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { SqliteDatastore } from '../datastores/sqlite.js'
import { desktopDatastorePaths } from '../datastores/sqliteNode.js'
import { migrateLegacyHistoryRecord } from '../history.js'
import { NON_TRANSFERABLE_SETTINGS } from '../nonTransferableSettings.js'
import { createDefaultSettings, resolveDefaultLandingPage } from '../settingsDefaults.js'
import { BACKUP_SECTIONS, createUnifiedBackup } from '../renderer/helpers/unifiedBackup.js'
import { migrateLegacySettings } from '../renderer/helpers/settings-migrations.js'

const { profileDirectory, sections = BACKUP_SECTIONS, settings: currentSettings } = workerData

async function prepareArchive() {
  const databases = new Map()
  function open(name, childField) {
    if (databases.has(name)) return databases.get(name).datastore
    const { filename } = desktopDatastorePaths(profileDirectory, name)
    const database = new DatabaseSync(filename, { readOnly: true })
    // Keep each collection, including playlist children, in one read snapshot.
    database.exec('PRAGMA busy_timeout = 5000; BEGIN')
    const datastore = new SqliteDatastore({
      childField,
      driver: {
        async execute(statements) {
          return statements.map(([sql, parameters = []]) => {
            const statement = database.prepare(sql)
            statement.setReturnArrays(true)
            return statement.all(...parameters)
          })
        },
      },
    })
    databases.set(name, { database, datastore })
    return datastore
  }
  const readers = {
    async settings() {
      if (currentSettings) return currentSettings
      const [savedSettings, savedProfiles] = await Promise.all([
        open('settings').findAsync({ _id: { $ne: 'bounds' } }), open('profiles').findAsync({}),
      ])
      const isFreshInstallation = savedSettings.length === 0 && savedProfiles.length === 0
      const resolvedSettings = {
        ...createDefaultSettings({ supportsLocalApi: true, isElectron: true }),
        landingPage: resolveDefaultLandingPage(isFreshInstallation),
        aiVideoSummaryMode: isFreshInstallation ? 'collapsed' : 'hide',
        ...migrateLegacySettings(Object.fromEntries(savedSettings.map(setting => [setting._id, setting.value]))),
      }
      return Object.fromEntries(Object.entries(resolvedSettings).filter(([key]) => !NON_TRANSFERABLE_SETTINGS.has(key)))
    },
    profiles: () => open('profiles').findAsync({}),
    playlists: () => open('playlists', 'videos').findAsync({}),
    async history() {
      const records = await open('history').findAsync({}).sort({ timeWatched: -1 })
      // Like the app's history, keep only the newest record of a video that
      // older sync runs stored twice.
      const seen = new Set()
      return records.filter(record => !seen.has(record.videoId) && seen.add(record.videoId)).map(migrateLegacyHistoryRecord)
    },
    searchHistory: () => open('search-history').findAsync({}).sort({ lastUpdatedAt: -1 }),
    async watchStats() {
      const watchStats = open('watch-stats')
      const [records, migration] = await Promise.all([
        watchStats.findAsync({ date: { $exists: true } }).sort({ date: 1 }),
        watchStats.findOneAsync({ _id: 'history-watch-time-v1' }),
      ])
      return { records, adjustment: migration?.adjustment ?? null }
    },
  }
  let data
  try {
    const selected = sections.filter(section => Object.hasOwn(readers, section))
    data = Object.fromEntries(await Promise.all(selected.map(async section => [section, await readers[section]()])))
  } finally {
    for (const { database } of databases.values()) database.close()
  }
  const archive = createUnifiedBackup(data)
  const buffer = await archive.arrayBuffer()
  parentPort.postMessage(new Uint8Array(buffer), [buffer])
}

prepareArchive()
