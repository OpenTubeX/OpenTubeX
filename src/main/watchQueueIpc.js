// @ts-check
import { IpcChannels } from '../constants'
import { handleTrusted, sendToOtherAppWindows } from './ipc'

/**
 * Applies watch queue changes from any window and shares each new revision
 * with the others. The window that made the change gets it as its reply.
 * @param {(request: unknown) => Promise<import('./watchQueue').WatchQueueSnapshot>} updateWatchQueue
 */
export function setupWatchQueueIpc(updateWatchQueue) {
  let broadcastRevision = 0
  handleTrusted(IpcChannels.WATCH_QUEUE_UPDATE, async (event, request) => {
    try {
      const snapshot = await updateWatchQueue(request)
      if (snapshot.revision > broadcastRevision) {
        broadcastRevision = snapshot.revision
        sendToOtherAppWindows(event.sender, IpcChannels.WATCH_QUEUE_UPDATED, snapshot)
      }
      return snapshot
    } catch (error) {
      return { error: error.message }
    }
  }, { error: 'Invalid watch queue sender' })
}
