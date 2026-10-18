import { Worker } from 'node:worker_threads'

/** Create a scheduled archive after datastore initialization and migrations. */
export function createBackupArchiveFactory(profileDirectory, workerPath, { waitForDatastores, settings, watchStats }) {
  return async () => {
    await waitForDatastores()
    await settings.migrate()
    await watchStats.migrateHistory()
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: profileDirectory })
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`Backup worker exited without returning an archive (${code})`)))
    })
  }
}
