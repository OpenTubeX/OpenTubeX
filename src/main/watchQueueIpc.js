import { IpcChannels } from '../constants'
import { handleTrusted, sendToAppWindows } from './ipc'

/**
 * Applies watch queue changes from any window and shares each new revision
 * with all of them.
 * @param {(request: unknown) => Promise<{ revision: number }>} updateWatchQueue
 */
export function setupWatchQueueIpc(updateWatchQueue) {
  let broadcastRevision = 0
  handleTrusted(IpcChannels.WATCH_QUEUE_UPDATE, async (_event, request) => {
    try {
      const snapshot = await updateWatchQueue(request)
      if (snapshot.revision > broadcastRevision) {
        broadcastRevision = snapshot.revision
        sendToAppWindows(IpcChannels.WATCH_QUEUE_UPDATED, snapshot)
      }
      return snapshot
    } catch (error) {
      return { error: error.message }
    }
  }, { error: 'Invalid watch queue sender' })
}
