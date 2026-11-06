import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'
import { createBackupArchiveFactory } from '../../src/main/backupArchive.js'
import { readUnifiedBackup } from '../../src/renderer/helpers/unifiedBackup.js'

test('startup archives migrate historical watch time and preserve it through restore', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-backup-migration-'))
  const databases = Object.fromEntries(['settings', 'profiles', 'playlists', 'history', 'search-history', 'watch-stats']
    .map(name => [name, createDesktopDatastore(path.join(directory, `${name}.sqlite`), undefined,
      name === 'playlists' ? { childField: 'videos' } : {})]))
  t.after(async () => {
    await Promise.all(Object.values(databases).map(database => database.driver.close()))
    await rm(directory, { recursive: true, force: true })
  })
  await Promise.all(Object.values(databases).map(database => database.loadDatabaseAsync()))
  await databases.history.insertAsync([
    { _id: 'partial', videoId: 'partial', authorId: 'UClegacy', timeWatched: Date.UTC(2026, 9, 1, 12), lengthSeconds: 120, watchProgress: 30 },
    { _id: 'complete', videoId: 'complete', authorId: 'UClegacy', timeWatched: Date.UTC(2026, 9, 1, 12), lengthSeconds: 60, watchProgress: 60 },
  ])
  globalThis.__scheduledBackupMigrationDatastores = databases
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '../index' && context.parentURL?.endsWith('/datastores/handlers/base.js')) {
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
          const databases = globalThis.__scheduledBackupMigrationDatastores;
          export const settings = databases.settings;
          export const history = databases.history;
          export const watchStats = databases['watch-stats'];
          export const recommendations = {};
        `) }
      }
      if (specifier.startsWith('.') && !specifier.endsWith('.js')) return nextResolve(`${specifier}.js`, context)
      return nextResolve(specifier, context)
    },
  })
  let handlers
  try {
    handlers = await import('../../src/datastores/handlers/base.js')
  } finally {
    hooks.deregister()
    delete globalThis.__scheduledBackupMigrationDatastores
  }
  const createArchive = createBackupArchiveFactory(directory, new URL('../../src/main/backupArchiveWorker.js', import.meta.url), {
    waitForDatastores: async () => {}, settings: handlers.settings, watchStats: handlers.watchStats,
  })
  const backup = await readUnifiedBackup(new Blob([await createArchive()]))
  assert.equal(backup.data.watchStats.records.reduce((seconds, record) => seconds + record.seconds, 0), 90)
  assert.equal(backup.data.watchStats.records[0].historyEstimateByChannel.UClegacy, 90)
  await databases['watch-stats'].removeAsync({}, { multi: true })
  await databases.history.removeAsync({}, { multi: true })
  await databases.history.insertAsync(backup.data.history)
  await handlers.watchStats.mergeBackup(backup.data.watchStats)
  assert.equal(await handlers.watchStats.migrateHistory(), true)
  assert.equal((await handlers.watchStats.find()).reduce((seconds, record) => seconds + record.seconds, 0), 90)
})
