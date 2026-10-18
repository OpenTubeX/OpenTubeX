import { Worker } from 'node:worker_threads'

/** Create a scheduled archive callback that waits for datastore initialization. */
export function createBackupArchiveFactory(profileDirectory, workerPath, waitForDatastores) {
  return async () => {
    await waitForDatastores()
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: profileDirectory })
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', code => reject(new Error(`Backup worker exited without returning an archive (${code})`)))
    })
  }
}
