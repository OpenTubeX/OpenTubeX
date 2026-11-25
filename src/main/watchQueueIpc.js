// @ts-check
import { IpcChannels } from '../constants'
import { handleTrusted, sendToOtherAppWindows } from './ipc'

/**
 * Applies watch queue changes from any window and shares each new revision
 * with the others. The window that made the change gets it as its reply.
 * Each separate profile has its own queue, with its own revisions.
 * @param {(request: unknown, scope: string | null) => Promise<import('./watchQueue').WatchQueueSnapshot>} updateWatchQueue
 * @param {(scope: unknown) => Promise<{ scope: string | null }>} resolveScope rejects scopes of profiles that are not separate
 */
export function setupWatchQueueIpc(updateWatchQueue, resolveScope) {
  /** @type {Map<string | null, number>} */
  const broadcastRevisions = new Map()
  handleTrusted(IpcChannels.WATCH_QUEUE_UPDATE, async (event, message) => {
    try {
      const { scope: requestedScope, ...request } = /** @type {{ scope?: unknown }} */ (message)
      const { scope } = await resolveScope(requestedScope)
      const snapshot = { ...await updateWatchQueue(request, scope), scope }
      if (snapshot.revision > (broadcastRevisions.get(scope) ?? 0)) {
        broadcastRevisions.set(scope, snapshot.revision)
        sendToOtherAppWindows(event.sender, IpcChannels.WATCH_QUEUE_UPDATED, snapshot)
      }
      return snapshot
    } catch (error) {
      return { error: error.message }
    }
  }, { error: 'Invalid watch queue sender' })
}
