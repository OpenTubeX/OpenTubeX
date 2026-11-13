// @ts-check

/**
 * Feeds cached longer than this are fetched in full even without new uploads,
 * so view counts and other metadata still update.
 */
export const UPLOAD_CHECK_MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000

/** Automatic refreshes leave out channels whose feed was fetched this recently. */
export const RECENT_SUBSCRIPTION_FETCH_MS = 10 * 60 * 1000

// YouTube's channel feed lists only this many of the newest uploads.
const CHANNEL_RSS_ENTRY_LIMIT = 15

// Uploads can reach the channel pages and feeds a while after their
// publication time, so ones published shortly before the last fetch may be new.
const UPLOAD_LISTING_DELAY_MS = 2 * 60 * 60 * 1000

/**
 * @param {{ timestamp?: Date | number | string } | undefined} cacheEntry
 */
function getFetchTime(cacheEntry) {
  return cacheEntry?.timestamp == null ? Number.NaN : new Date(cacheEntry.timestamp).getTime()
}

/**
 * @param {{ timestamp?: Date | number | string } | undefined} cacheEntry
 * @param {number} now
 */
export function isSubscriptionFeedRecentlyFetched(cacheEntry, now) {
  const fetchedAt = getFetchTime(cacheEntry)
  return fetchedAt <= now && now - fetchedAt < RECENT_SUBSCRIPTION_FETCH_MS
}

/**
 * Whether the cached feed may be kept when the channel has no new uploads.
 * Scheduled and live entries change state without a new upload, so their
 * feeds are always fetched.
 * @param {{ timestamp?: Date | number | string, videos?: Record<string, unknown>[] } | undefined} cacheEntry
 * @param {number} now
 */
export function canKeepSubscriptionFeedWithoutNewUploads(cacheEntry, now) {
  const fetchedAt = getFetchTime(cacheEntry)
  if (!(fetchedAt <= now && now - fetchedAt < UPLOAD_CHECK_MAX_CACHE_AGE_MS) || !Array.isArray(cacheEntry?.videos)) {
    return false
  }

  return !cacheEntry.videos.some(video =>
    video.isUpcoming === true ||
    video.premiere === true ||
    video.isPremiere === true ||
    video.liveNow === true ||
    video.isLive === true
  )
}

/**
 * Whether the channel's upload feed shows nothing for `feed` that was
 * published since the last fetch and is missing from the caches. Older
 * uploads that the last fetch did not return belong to other feeds, such as
 * live stream recordings in the videos check. Requires the upload feed to
 * reach back to the last fetch, as newer uploads may have dropped out of it.
 * @param {'videos' | 'shorts' | 'live'} feed
 * @param {{ timestamp?: Date | number | string } | undefined} cacheEntry
 * @param {{ videoId: string, published: number, isShort?: boolean }[]} uploads
 * @param {Set<string>} knownVideoIds
 */
export function hasNoNewSubscriptionUploads(feed, cacheEntry, uploads, knownVideoIds) {
  const fetchedAt = getFetchTime(cacheEntry)
  if (uploads.length === 0 || !Number.isFinite(fetchedAt)) return false
  if (uploads.length >= CHANNEL_RSS_ENTRY_LIMIT && Math.min(...uploads.map(upload => upload.published)) > fetchedAt) {
    return false
  }

  const wantsShorts = feed === 'shorts'
  return uploads
    .filter(upload => (upload.isShort === true) === wantsShorts && upload.published > fetchedAt - UPLOAD_LISTING_DELAY_MS)
    .every(upload => knownVideoIds.has(upload.videoId))
}
