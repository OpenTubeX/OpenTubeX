import { Worker } from 'node:worker_threads'

/** Serialize, encode, and compress complete backups away from Electron's main thread. */
export function createBackupArchive(data, workerPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: data })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', code => reject(new Error(`Backup worker exited without returning an archive (${code})`)))
  })
}
