import { Worker } from 'node:worker_threads'

/**
 * Create an archive after datastore initialization and migrations. It contains
 * every section and the saved settings unless the caller provides them.
 */
export function createBackupArchiveFactory(profileDirectory, workerPath, { waitForDatastores, settings, watchStats }) {
  return async ({ sections, settings: currentSettings } = {}) => {
    await waitForDatastores()
    await settings.migrate()
    await watchStats.migrateHistory()
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { profileDirectory, sections, settings: currentSettings } })
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`Backup worker exited without returning an archive (${code})`)))
    })
  }
}
