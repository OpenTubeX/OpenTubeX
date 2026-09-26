import { hasReachedWatchedThreshold, isHistoryEntryWatched } from '../../../history.js'

/** @typedef {Record<string, number>} PendingWatchTime */
/**
 * @typedef {{
 *   historyEntry?: {watchProgress?: number, published?: number, [key: string]: unknown},
 *   localFilePlayback: boolean, videoId: string,
 *   videoTitle: string, channelName: string, channelId: string,
 *   videoPublished: number, videoDescription: string, videoViewCount: number,
 *   videoLengthSeconds: number, isLive: boolean, isUpcoming: boolean,
 * }} WatchHistorySnapshot
 */
/**
 * @typedef {{
 *   canSaveWatchProgress: boolean, presented: boolean, hasBeenPresented: boolean,
 *   playerTeardownInProgress: boolean, hasPlaybackPosition: boolean,
 *   shortsPlaybackCompleted: boolean, watchedProgressSavingEnabled: boolean,
 *   videoLengthSeconds: number, currentTime: number | (() => number),
 *   historyEntryExists: boolean, videoId: string,
 * }} WatchProgressSnapshot
 */

/**
 * Build the datastore record from an explicit snapshot of Watch state.
 * @param {WatchHistorySnapshot} state
 * @param {number} watchProgress
 * @param {boolean} isWatched
 * @param {number} now
 */
export function buildWatchHistoryEntry(state, watchProgress, isWatched, now) {
  // A downloaded file can play before its channel metadata is available.
  const metadata = state.localFilePlayback && !state.channelId && state.historyEntry
    ? state.historyEntry
    : {
        title: state.videoTitle,
        author: state.channelName,
        authorId: state.channelId,
        published: state.videoPublished > 0 ? state.videoPublished : state.historyEntry?.published,
        description: state.videoDescription,
        viewCount: state.videoViewCount,
      }

  return {
    ...state.historyEntry,
    ...metadata,
    videoId: state.videoId,
    lengthSeconds: state.videoLengthSeconds,
    watchProgress,
    isWatched,
    timeWatched: now,
    isLive: state.isLive,
    isUpcoming: state.isUpcoming,
    type: 'video',
  }
}

/**
 * @param {{rememberHistory: boolean, historyRetentionEnabled: boolean, videoPlayerLoaded: boolean,
 *   isUpcoming: boolean, isLive: boolean, playerPaused: boolean, historyLastTouchedAt: number}} state
 * @param {number} now
 * @returns {boolean}
 */
export function shouldKeepHistoryEntryAlive(state, now) {
  return state.rememberHistory && state.historyRetentionEnabled && state.videoPlayerLoaded &&
    !state.isUpcoming && !state.isLive && !state.playerPaused &&
    now - state.historyLastTouchedAt >= 60_000
}

/**
 * @param {{rememberHistory: boolean, isUpcoming: boolean, isLive: boolean,
 *   historyEntry?: {isWatched?: boolean, watchProgress?: number, lengthSeconds?: number},
 *   playerPaused: boolean, videoLengthSeconds: number, watchedPercentageThreshold: number,
 *   watchedProgressSavingEnabled: boolean}} state
 * @param {number} currentSeconds
 * @param {boolean} [isFinished]
 * @returns {number | null}
 */
export function planWatchedCompletion(state, currentSeconds, isFinished = false) {
  if (!state.rememberHistory || state.isUpcoming || state.isLive || isHistoryEntryWatched(state.historyEntry)) return null
  if (!isFinished && state.playerPaused) return null
  if (!isFinished && !hasReachedWatchedThreshold(currentSeconds, state.videoLengthSeconds, state.watchedPercentageThreshold)) return null
  return state.watchedProgressSavingEnabled ? currentSeconds : (state.historyEntry?.watchProgress ?? 0)
}

/**
 * @param {{rememberHistory: boolean, customShortsPlayerActive: boolean,
 *   shortsPlaybackCompleted: boolean, isUpcoming: boolean, isLive: boolean,
 *   videoLengthSeconds: number, playerLoaded: boolean, playerPaused: boolean,
 *   reachedEnd: boolean, watchedProgressSavingEnabled: boolean,
 *   historyEntry?: {watchProgress?: number}}} state
 * @returns {number | null}
 */
export function planShortCompletion(state) {
  if (!state.rememberHistory || !state.customShortsPlayerActive || state.shortsPlaybackCompleted ||
    state.isUpcoming || state.isLive || !(state.videoLengthSeconds > 0) ||
    !state.playerLoaded || state.playerPaused || !state.reachedEnd) return null
  return state.watchedProgressSavingEnabled
    ? state.videoLengthSeconds
    : (state.historyEntry?.watchProgress ?? 0)
}

/**
 * @param {WatchProgressSnapshot} state
 * @returns {{type: 'history', watchProgress: number} | {type: 'progress', videoId: string, watchProgress: number} | null}
 */
export function planWatchProgressSave(state) {
  if (!state.canSaveWatchProgress || !state.presented || !state.hasBeenPresented ||
    state.playerTeardownInProgress || !state.hasPlaybackPosition) return null
  const watchProgress = state.shortsPlaybackCompleted && state.watchedProgressSavingEnabled
    ? state.videoLengthSeconds
    : typeof state.currentTime === 'function' ? state.currentTime() : state.currentTime
  return state.historyEntryExists
    ? { type: 'progress', videoId: state.videoId, watchProgress }
    : { type: 'history', watchProgress }
}

/**
 * @param {{lastTick: number | null, pendingByDate: PendingWatchTime}} state
 * @param {number} now
 * @param {string} date
 */
export function sampleWatchTime(state, now, date) {
  const elapsed = state.lastTick === null ? 0 : now - state.lastTick
  const pendingByDate = { ...state.pendingByDate }
  // Suspended and heavily delayed timers do not represent watched time.
  if (elapsed > 0 && elapsed <= 5000) {
    pendingByDate[date] = (pendingByDate[date] ?? 0) + elapsed
  }
  const pendingMilliseconds = Object.values(pendingByDate)
    .reduce((total, milliseconds) => total + milliseconds, 0)
  return { lastTick: now, pendingByDate, shouldFlush: pendingMilliseconds >= 10000 }
}

/**
 * @param {PendingWatchTime} pendingByDate
 * @param {(record: {date: string, seconds: number}) => Promise<unknown>} recordWatchTime
 */
export function persistWatchTime(pendingByDate, recordWatchTime) {
  return Promise.all(Object.entries(pendingByDate).map(([date, milliseconds]) =>
    recordWatchTime({ date, seconds: milliseconds / 1000 })
  ))
}
