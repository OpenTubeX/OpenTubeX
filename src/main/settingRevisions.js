import { SyncEvents } from '../constants'

let latestRevision = 0

/**
 * Builds the `SYNC_SETTINGS` message for a saved setting. Call it right after
 * the save, so revisions follow the order in which the datastore applied the
 * saves. Broadcasts and invoke replies reach a window through different Mojo
 * pipes, which can reorder them, so windows use the revision to drop a
 * broadcast older than a save they already have.
 * @param {string} _id
 * @param {unknown} value
 */
export function settingSyncMessage(_id, value) {
  return { event: SyncEvents.GENERAL.UPSERT, data: { _id, value }, revision: ++latestRevision }
}
