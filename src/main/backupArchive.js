import { Worker } from 'node:worker_threads'

/** Read the profile and prepare a complete backup away from Electron's main thread. */
export function createBackupArchive(profileDirectory, workerPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: profileDirectory })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', code => reject(new Error(`Backup worker exited without returning an archive (${code})`)))
  })
}
