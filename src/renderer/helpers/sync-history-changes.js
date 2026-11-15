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
    case 'updateRecordLastViewedPlaylistIdInHistoryCache':
      return [payload.videoId]
    case 'unsetRecordsLastViewedPlaylistIdInHistoryCache':
      return [...payload.videoIds]
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
  /** @type {Set<(ids: string[] | null) => void>} */
  const watchers = new Set()

  return {
    /** @param {{ type: string, payload: any }} mutation A history store mutation */
    record({ type, payload }) {
      const ids = changedVideoIds(type, payload)
      for (const watcher of watchers) watcher(ids)
      if (UNSYNCED_MUTATIONS.has(type) || !changed) return
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

    /**
     * Collects the entries changed from now on, including fields sync does not
     * carry, so a sync can tell whether its result would overwrite an edit.
     * @returns {{ changed: () => Set<string> | null, stop: () => void }}
     */
    watch() {
      /** @type {Set<string> | null} */
      let seen = new Set()
      /** @param {string[] | null} ids */
      const watcher = ids => {
        if (!ids) seen = null
        else if (seen) for (const id of ids) seen.add(id)
      }
      watchers.add(watcher)
      return { changed: () => seen, stop: () => { watchers.delete(watcher) } }
    },
  }
}

/** Changed history entries since the last sync took them. */
export const historyChanges = createHistoryChangeTracker()
