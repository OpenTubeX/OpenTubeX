// @ts-check

// Mutations that change only fields history sync does not carry.
const UNSYNCED_MUTATIONS = new Set([
  'updateRecordLastViewedPlaylistIdInHistoryCache',
  'unsetRecordsLastViewedPlaylistIdInHistoryCache',
  'unsetRecordsLastViewedPlaylistIdsInHistoryCache',
])

/**
 * @param {string} type
 * @param {any} payload
 * @returns {string[] | null} The changed video IDs, or null when any record may have changed
 */
function changedVideoIds(type, payload) {
  switch (type) {
    case 'upsertToHistoryCache':
      return [payload.videoId]
    case 'updateRecordWatchProgressInHistoryCache':
      return [payload.videoId]
    case 'removeFromHistoryCacheById':
      return [payload]
    case 'removeMultipleFromHistoryCache':
      return [...payload]
    case 'applyHistorySyncChanges':
      return [...payload.insertions, ...payload.updates].map(record => record.videoId).concat(payload.deletions)
    default:
      return null
  }
}

/**
 * Records which history entries changed since the last sync took them, so a
 * sync can merge only those entries. Everything counts as changed until the
 * first sync takes the changes, because the tracker cannot know what happened
 * before it was created.
 */
export function createHistoryChangeTracker() {
  /** @type {Set<string> | null} null means every entry may have changed */
  let changed = null

  return {
    /** @param {{ type: string, payload: any }} mutation A history store mutation */
    record({ type, payload }) {
      if (UNSYNCED_MUTATIONS.has(type) || !changed) return
      const ids = changedVideoIds(type, payload)
      if (ids) {
        for (const id of ids) changed.add(id)
      } else {
        changed = null
      }
    },

    /** @returns {Set<string> | null} The changes so far, which are then cleared */
    take() {
      const taken = changed
      changed = new Set()
      return taken
    },

    /** Restores changes a failed sync took. @param {Set<string> | null} taken */
    restore(taken) {
      if (!taken || !changed) {
        changed = null
        return
      }
      for (const id of taken) changed.add(id)
    },
  }
}

/** Changed history entries since the last sync took them. */
export const historyChanges = createHistoryChangeTracker()
