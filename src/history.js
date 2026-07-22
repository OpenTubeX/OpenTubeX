import {
  DEFAULT_WATCHED_PERCENTAGE_THRESHOLD,
  WATCHED_MAX_REMAINING_SECONDS,
} from './constants.js'

export { DEFAULT_WATCHED_PERCENTAGE_THRESHOLD, WATCHED_MAX_REMAINING_SECONDS }

/**
 * @param {object | undefined} historyEntry
 * @returns {boolean}
 */
export function isHistoryEntryWatched(historyEntry) {
  if (!historyEntry) {
    return false
  }

  if (typeof historyEntry.isWatched === 'boolean') {
    return historyEntry.isWatched
  }

  return hasReachedWatchedThreshold(historyEntry.watchProgress, historyEntry.lengthSeconds)
}

/**
 * @param {number} watchProgress
 * @param {number} lengthSeconds
 * @param {number} watchedPercentageThreshold
 * @returns {boolean}
 */
export function hasReachedWatchedThreshold(
  watchProgress,
  lengthSeconds,
  watchedPercentageThreshold = DEFAULT_WATCHED_PERCENTAGE_THRESHOLD
) {
  if (!Number.isFinite(watchProgress) || !Number.isFinite(lengthSeconds) || lengthSeconds <= 0) {
    return false
  }

  const threshold = Number.isFinite(watchedPercentageThreshold) &&
    watchedPercentageThreshold >= 0 && watchedPercentageThreshold <= 100
    ? watchedPercentageThreshold
    : DEFAULT_WATCHED_PERCENTAGE_THRESHOLD

  const hasReachedPercentage = watchProgress / lengthSeconds * 100 >= threshold
  if (threshold === 0 || threshold === 100) {
    return hasReachedPercentage
  }

  const isWithinLastTwoMinutes = lengthSeconds - watchProgress <= WATCHED_MAX_REMAINING_SECONDS

  return hasReachedPercentage && isWithinLastTwoMinutes
}

/**
 * @param {object} record
 * @returns {boolean}
 */
function isLegacyYouTubeTakeoutRecord(record) {
  return record.lengthSeconds === null &&
    record.watchProgress === 1 &&
    record.description === '' &&
    record.published === record.timeWatched &&
    typeof record.isLive === 'boolean' &&
    record.type === 'video'
}

/**
 * LibreTube history imported before watched-status support stored progress as
 * a fraction, while OpenTubeX otherwise stores progress in seconds.
 *
 * @param {object} record
 * @returns {boolean}
 */
function isLegacyLibreTubeRecord(record) {
  return Number.isFinite(record.lengthSeconds) &&
    record.lengthSeconds > 0 &&
    Number.isFinite(record.watchProgress) &&
    record.watchProgress >= 0 &&
    record.watchProgress <= 1 &&
    record.description === '' &&
    record.published === record.timeWatched &&
    record.isLive === false &&
    record.type === 'video'
}

/**
 * @param {object} record
 * @returns {object}
 */
export function migrateLegacyHistoryRecord(record) {
  if (typeof record.isWatched === 'boolean') {
    return record
  }

  if (isLegacyYouTubeTakeoutRecord(record)) {
    return { ...record, isWatched: true, isLive: false }
  }

  if (isLegacyLibreTubeRecord(record)) {
    const progressRatio = record.watchProgress
    const watchProgress = progressRatio * record.lengthSeconds

    return {
      ...record,
      watchProgress,
      isWatched: hasReachedWatchedThreshold(watchProgress, record.lengthSeconds),
    }
  }

  return {
    ...record,
    isWatched: hasReachedWatchedThreshold(record.watchProgress, record.lengthSeconds),
  }
}
