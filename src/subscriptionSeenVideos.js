import { isHistoryEntryWatched } from './history.js'
import { mergeSeenMarks, parseSeenMarks } from './seenMarks.js'

export const MAX_SUBSCRIPTION_SEEN_VIDEOS = 10000

/**
 * @typedef {{ videoId: string, seenAt: number, unseenAt?: number, isMembersOnly: boolean }} SeenVideoMark
 * `unseenAt` is the time of the latest reverse action, see {@link SEEN_VIDEO_MARKS}.
 */

/** @type {import('./seenMarks.js').SeenMarkKind<SeenVideoMark>} */
export const SEEN_VIDEO_MARKS = {
  idKey: 'videoId',
  max: MAX_SUBSCRIPTION_SEEN_VIDEOS,
  parse: entries => entries.filter(entry => (
    typeof entry?.videoId === 'string' && entry.videoId.length > 0 &&
    Number.isFinite(entry.seenAt) && entry.seenAt > 0
  )),
  merge(previous, entry) {
    // Retain the reverse action so an older synced seen mark cannot undo it.
    const unseenAt = Math.max(previous?.unseenAt ?? 0,
      Number.isFinite(entry.unseenAt) && entry.unseenAt > 0 ? entry.unseenAt : 0)
    return {
      videoId: entry.videoId,
      seenAt: Math.max(previous?.seenAt ?? 0, entry.seenAt),
      ...(unseenAt > 0 ? { unseenAt } : {}),
      // Keep public marks even when a stale device saw the members-only upload.
      isMembersOnly: entry.isMembersOnly === true && previous?.isMembersOnly !== false,
    }
  },
  latest: entry => Math.max(entry.seenAt, entry.unseenAt ?? 0),
}

export function parseSubscriptionSeenVideos(value) {
  return parseSeenMarks(SEEN_VIDEO_MARKS, value)
}

/**
 * Whether a mark stays in the list: watched videos leave it, but a reverse
 * mark still needs to clear older watched history on other devices, even
 * after another seen action.
 * @param {Record<string, any>} historyById
 */
export function keepsSeenVideoMark(historyById) {
  return entry => entry.unseenAt > 0 || !isHistoryEntryWatched(historyById[entry.videoId])
}

// Evict oldest marks only after removing watched videos.
export function mergeSubscriptionSeenVideos(local, remote, historyById = {}) {
  return mergeSeenMarks(SEEN_VIDEO_MARKS, local, remote, keepsSeenVideoMark(historyById))
}
