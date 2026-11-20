// @ts-check
import { reconcileFetchedSubscriptionEntries } from './subscription-entries.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** A channel's Home tab is checked for collaborations at most this often. */
export const COLLABORATION_CHECK_INTERVAL_MS = DAY_MS

/** Channels whose last check found no collaborations are checked this often. */
export const COLLABORATION_CHECK_INTERVAL_WITHOUT_COLLABORATIONS_MS = 7 * DAY_MS

/** Each video refresh checks at most this many channels. */
export const COLLABORATION_CHECKS_PER_REFRESH = 12

/**
 * @typedef {{
 *   videos?: Record<string, any>[] | null,
 *   timestamp?: Date | number | string,
 *   collaborationsCheckedAt?: number | null
 * }} VideoCacheEntry
 */

/**
 * When the channel's Home tab is due for its next collaboration check:
 * immediately if it was never checked, otherwise a day after the last
 * successful check, or a week after it if that found no collaborations.
 * @param {VideoCacheEntry | undefined} cacheEntry
 * @param {number} now
 */
function getCollaborationCheckDueTime(cacheEntry, now) {
  const checkedAt = cacheEntry?.collaborationsCheckedAt
  // A check stored with a clock that was ahead is repeated
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || checkedAt > now) return -Infinity
  const found = cacheEntry?.videos?.some(video => video.isCollaboration === true) === true
  return checkedAt + (found ? COLLABORATION_CHECK_INTERVAL_MS : COLLABORATION_CHECK_INTERVAL_WITHOUT_COLLABORATIONS_MS)
}

/**
 * The channels to check for collaborations, never checked ones first, then
 * the most overdue. Channels without cached uploads wait for their uploads,
 * which the collaborations are stored with.
 * @template {{ id: string }} T
 * @param {T[]} channels
 * @param {Record<string, VideoCacheEntry | undefined>} videoCache
 * @param {number} now
 * @param {number} [limit]
 * @returns {T[]}
 */
export function selectSubscriptionCollaborationChecks(channels, videoCache, now, limit = COLLABORATION_CHECKS_PER_REFRESH) {
  return channels
    .filter(channel => Array.isArray(videoCache[channel.id]?.videos))
    .map(channel => ({ channel, due: getCollaborationCheckDueTime(videoCache[channel.id], now) }))
    .filter(({ due }) => due <= now)
    .sort((a, b) => a.due - b.due)
    .slice(0, limit)
    .map(({ channel }) => channel)
}

/**
 * The channel's cached uploads followed by the collaborations a check found,
 * which replace the cached ones. New collaborations are recognized against
 * the last check, as the uploads against the last fetch.
 * @param {VideoCacheEntry & { videos: Record<string, any>[] }} cacheEntry
 * @param {Record<string, any>[]} collaborations
 * @param {Record<string, any>} [historyById]
 */
export function mergeSubscriptionCollaborations(cacheEntry, collaborations, historyById) {
  const uploads = cacheEntry.videos.filter(video => video.isCollaboration !== true)
  const uploadIds = new Set(uploads.map(video => video.videoId))
  return uploads.concat(reconcileFetchedSubscriptionEntries(
    collaborations.filter(video => !uploadIds.has(video.videoId)),
    cacheEntry.videos.filter(video => video.isCollaboration === true),
    'videoId',
    cacheEntry.collaborationsCheckedAt ?? cacheEntry.timestamp,
    historyById
  ))
}
