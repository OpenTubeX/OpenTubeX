import { parentPort, workerData } from 'node:worker_threads'
import { createUnifiedBackup } from '../renderer/helpers/unifiedBackup.js'

async function prepareArchive() {
  const archive = createUnifiedBackup(workerData)
  const buffer = await archive.arrayBuffer()
  parentPort.postMessage(new Uint8Array(buffer), [buffer])
}

prepareArchive().catch(error => { throw error })
