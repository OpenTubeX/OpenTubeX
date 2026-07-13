import { WATCHED_THRESHOLD } from '../../constants'

export { WATCHED_THRESHOLD }

/**
 * @param {object | undefined} historyEntry
 * @returns {boolean}
 */
export function isHistoryEntryWatched(historyEntry) {
  if (!historyEntry) {
    return false
  }

  if (historyEntry.isWatched === true) {
    return true
  }

  return hasReachedWatchedThreshold(historyEntry.watchProgress, historyEntry.lengthSeconds)
}

/**
 * @param {number} watchProgress
 * @param {number} lengthSeconds
 * @returns {boolean}
 */
export function hasReachedWatchedThreshold(watchProgress, lengthSeconds) {
  return Number.isFinite(watchProgress) &&
    Number.isFinite(lengthSeconds) &&
    lengthSeconds > 0 &&
    watchProgress / lengthSeconds >= WATCHED_THRESHOLD
}
