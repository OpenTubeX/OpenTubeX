import { toRaw } from 'vue'
import { isHistoryEntryWatched } from '../../history'

export {
  canMarkHistoryEntryAsWatched,
  compareHistoryRecordsNewestFirst,
  getRetentionCutoff,
  hasReachedWatchedThreshold,
  HISTORY_MIN_PLAYBACK_SECONDS,
  isHistoryEntryWatched,
  migrateLegacyHistoryRecord,
  DEFAULT_WATCHED_PERCENTAGE_THRESHOLD,
  WATCHED_MAX_REMAINING_SECONDS,
} from '../../history'

/**
 * Drops watched videos from search results and recommendations when the user hides them.
 * Items without a video ID, such as channels and playlists, stay.
 * @template {{ videoId?: string }} T
 * @param {T[]} items
 * @param {object} getters the store getters
 * @returns {T[]}
 */
export function withoutWatchedDiscoveryVideos(items, getters) {
  if (!getters.getHideWatchedInSearchAndRecommendations) return items
  getters.getHistoryEntriesRevision // eslint-disable-line no-unused-expressions
  const historyById = toRaw(getters.getHistoryCacheById)
  return items.filter(item => item.videoId == null || !isHistoryEntryWatched(historyById[item.videoId]))
}
