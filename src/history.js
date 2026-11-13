import {
  DEFAULT_WATCHED_PERCENTAGE_THRESHOLD,
  WATCHED_MAX_REMAINING_SECONDS,
} from './constants.js'

export { DEFAULT_WATCHED_PERCENTAGE_THRESHOLD, WATCHED_MAX_REMAINING_SECONDS }

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The oldest timestamp history retention keeps.
 * @param {unknown} days
 * @returns {number | null} null when history is kept forever
 */
export function getRetentionCutoff(days) {
  const parsedDays = Number(days)
  if (!Number.isInteger(parsedDays) || parsedDays < 1) {
    return null
  }

  return Date.now() - parsedDays * MILLISECONDS_PER_DAY
}

/**
 * @param {object | undefined} historyEntry
 * @returns {boolean}
 */
export function canMarkHistoryEntryAsWatched(historyEntry) {
  if (historyEntry?.isLive === true) {
    return false
  }

  if (historyEntry?.isUpcoming !== true) {
    return true
  }

  if (historyEntry.premiereTimestamp == null) {
    return false
  }

  const premiereTimestamp = Number(historyEntry.premiereTimestamp) * 1000
  return Number.isFinite(premiereTimestamp) && premiereTimestamp <= Date.now()
}

/**
 * @param {object | undefined} historyEntry
 * @returns {boolean}
 */
export function isHistoryEntryWatched(historyEntry) {
  if (!historyEntry || !canMarkHistoryEntryAsWatched(historyEntry)) {
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

const timeWatched = record => typeof record.timeWatched === 'number' ? record.timeWatched : -Infinity

/** Sorts history newest first, with progress-only records that have no watch time last. */
export function compareHistoryRecordsNewestFirst(a, b) {
  return (timeWatched(b) - timeWatched(a)) || 0
}

/**
 * Sorts stored history newest first and keeps one record per video: the
 * newest, or the first stored when several were watched at the same time.
 * Older sync runs could store a video twice.
 * @param {object[]} records sorted in place
 * @returns {{ records: object[], duplicateIds: unknown[] }}
 */
export function newestUniqueHistoryRecords(records) {
  records.sort(compareHistoryRecordsNewestFirst)
  const seen = new Set()
  const duplicateIds = []
  const unique = records.filter(record => {
    if (!seen.has(record.videoId)) return seen.add(record.videoId)
    duplicateIds.push(record._id)
    return false
  })
  return { records: unique, duplicateIds }
}

/**
 * Takeout entries only know the title, channel and watch time, so the saved
 * record keeps its details (duration, resume position, thumbnail) and the
 * import only fills fields it lacks and moves the watch time forward.
 */
export function mergeTakeoutHistoryRecord(current, imported) {
  if (!current) return imported
  const merged = { ...current }
  // The channel name and ID only belong together, so fill neither when the saved one points elsewhere
  const sameChannel = (!current.authorId || current.authorId === imported.authorId) &&
    (!current.author || current.author === imported.author)
  for (const [key, value] of Object.entries(imported)) {
    if ((key === 'author' || key === 'authorId') && !sameChannel) continue
    if (merged[key] == null || merged[key] === '') merged[key] = value
  }
  merged.timeWatched = Math.max(current.timeWatched ?? 0, imported.timeWatched)
  merged.watchProgress = Math.max(current.watchProgress ?? 0, imported.watchProgress)
  merged.isWatched = current.isWatched === true || imported.isWatched === true
  return merged
}
