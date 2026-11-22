// @ts-check
import { isHistoryEntryWatched } from '../../history.js'
import { NEW_CONTENT_PUBLICATION_TOLERANCE_MS, reconcileFetchedSubscriptionEntries } from './subscription-entries.js'

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
 * which the collaborations are stored with. A failed check stays due, but
 * queues behind the channels that were due before it failed, so channels
 * that keep failing don't take every refresh's checks.
 * @template {{ id: string }} T
 * @param {T[]} channels
 * @param {Record<string, VideoCacheEntry | undefined>} videoCache
 * @param {number} now
 * @param {Map<string, number>} [failedAt] when the last check of a channel failed
 * @returns {T[]}
 */
export function selectSubscriptionCollaborationChecks(channels, videoCache, now, failedAt = new Map()) {
  return channels
    .filter(channel => Array.isArray(videoCache[channel.id]?.videos))
    .map(channel => ({ channel, due: getCollaborationCheckDueTime(videoCache[channel.id], now) }))
    .filter(({ due }) => due <= now)
    .map(({ channel, due }) => ({ channel, order: Math.max(due, failedAt.get(channel.id) ?? -Infinity) }))
    .sort((a, b) => a.order - b.order)
    .slice(0, COLLABORATION_CHECKS_PER_REFRESH)
    .map(({ channel }) => channel)
}

/**
 * The channel's cached uploads followed by the collaborations a check found,
 * which replace the cached ones. New collaborations are recognized against
 * the last check, as the uploads against the last fetch. Unwatched ones that
 * were not cached and were published since the last check are new too, even
 * when none of the cached ones is listed, but not on the first check.
 * @param {VideoCacheEntry & { videos: Record<string, any>[] }} cacheEntry
 * @param {Record<string, any>[]} collaborations
 * @param {Record<string, any>} [historyById]
 */
export function mergeSubscriptionCollaborations(cacheEntry, collaborations, historyById) {
  const uploads = cacheEntry.videos.filter(video => video.isCollaboration !== true)
  const uploadIds = new Set(uploads.map(video => video.videoId))
  const cached = cacheEntry.videos.filter(video => video.isCollaboration === true)
  const cachedIds = new Set(cached.map(video => video.videoId))
  const checkedAt = cacheEntry.collaborationsCheckedAt
  const isPublishedSinceCheck = (/** @type {Record<string, any>} */ video) => typeof checkedAt === 'number' &&
    !cachedIds.has(video.videoId) &&
    Number(video.published) >= checkedAt - NEW_CONTENT_PUBLICATION_TOLERANCE_MS &&
    !isHistoryEntryWatched(historyById?.[video.videoId])

  return uploads.concat(reconcileFetchedSubscriptionEntries(
    collaborations.filter(video => !uploadIds.has(video.videoId)),
    cached,
    'videoId',
    checkedAt ?? cacheEntry.timestamp,
    historyById
  ).map(video => !video.isNewInSubscriptionFeed && isPublishedSinceCheck(video)
    ? {
        ...video,
        isNewInSubscriptionFeed: true,
        arrivedNewInSubscriptionFeed: true,
        // In a separate profile's feeds, the shared profiles see it as new too.
        ...('sharedNewInSubscriptionFeed' in video ? { sharedNewInSubscriptionFeed: true } : {}),
      }
    : video))
}
