import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { SqliteDatastore } from '../datastores/sqlite.js'
import { desktopDatastorePaths } from '../datastores/sqliteNode.js'
import { migrateLegacyHistoryRecord } from '../history.js'
import { NON_TRANSFERABLE_SETTINGS } from '../nonTransferableSettings.js'
import { createDefaultSettings } from '../settingsDefaults.js'
import { createUnifiedBackup } from '../renderer/helpers/unifiedBackup.js'

async function prepareArchive() {
  const databases = []
  function open(name, childField) {
    const { filename } = desktopDatastorePaths(workerData, name)
    const database = new DatabaseSync(filename, { readOnly: true })
    databases.push(database)
    // Keep each collection, including playlist children, in one read snapshot.
    database.exec('PRAGMA busy_timeout = 5000; BEGIN')
    return new SqliteDatastore({
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
  }
  let data
  try {
    const settings = open('settings')
    const profiles = open('profiles')
    const playlists = open('playlists', 'videos')
    const history = open('history')
    const searchHistory = open('search-history')
    const watchStats = open('watch-stats')
    const [savedSettings, savedProfiles, savedPlaylists, savedHistory, savedSearchHistory, records, migration] = await Promise.all([
      settings.findAsync({ _id: { $ne: 'bounds' } }), profiles.findAsync({}), playlists.findAsync({}),
      history.findAsync({}).sort({ timeWatched: -1 }), searchHistory.findAsync({}).sort({ lastUpdatedAt: -1 }),
      watchStats.findAsync({ date: { $exists: true } }).sort({ date: 1 }),
      watchStats.findOneAsync({ _id: 'history-watch-time-v1' }),
    ])
    const resolvedSettings = {
      ...createDefaultSettings({ supportsLocalApi: true, isElectron: true }),
      ...Object.fromEntries(savedSettings.map(setting => [setting._id, setting.value])),
    }
    data = {
      settings: Object.fromEntries(Object.entries(resolvedSettings).filter(([key]) => !NON_TRANSFERABLE_SETTINGS.has(key))),
      profiles: savedProfiles,
      playlists: savedPlaylists,
      history: savedHistory.map(migrateLegacyHistoryRecord),
      searchHistory: savedSearchHistory,
      watchStats: { records, adjustment: migration?.adjustment ?? null },
    }
  } finally {
    for (const database of databases) database.close()
  }
  const archive = createUnifiedBackup(data)
  const buffer = await archive.arrayBuffer()
  parentPort.postMessage(new Uint8Array(buffer), [buffer])
}

prepareArchive()
