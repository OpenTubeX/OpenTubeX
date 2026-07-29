import { isHistoryEntryWatched } from '../../history.js'

// Scraped relative publication dates are approximate, so allow a small amount
// of rounding around the previous fetch without admitting genuinely old items.
const NEW_CONTENT_PUBLICATION_TOLERANCE_MS = 60 * 60 * 1000

/**
 * Adds YouTube's selected portrait thumbnails to dated Shorts entries without
 * replacing the exact publication and view metadata supplied by RSS.
 * @param {object[]} entries
 * @param {object[]} thumbnailEntries
 */
export function mergeSubscriptionShortThumbnails(entries, thumbnailEntries) {
  const thumbnailsByVideoId = new Map(
    thumbnailEntries
      .filter(entry => entry.videoId && entry.thumbnailUrl)
      .map(entry => [entry.videoId, entry.thumbnailUrl])
  )

  return entries.map(entry => {
    const thumbnailUrl = thumbnailsByVideoId.get(entry.videoId)
    return thumbnailUrl ? { ...entry, thumbnailUrl } : entry
  })
}

/**
 * Scraped publication dates are derived from relative texts ("3 days ago") and
 * are therefore recalculated against the current time on every fetch. Entries
 * of already fetched channels would drift forwards past entries of channels
 * that haven't been refetched yet, which visibly reorders the feed while it
 * refreshes. Premieres and live streams are excluded, as their publication
 * dates legitimately change.
 * @param {object} entry
 */
function hasVolatilePublicationDate(entry) {
  return entry.liveNow === true ||
    entry.isUpcoming === true ||
    entry.premiereDate != null ||
    entry.premiereTimestamp != null
}

/**
 * @param {object} entry
 * @param {object} previousEntry
 * @param {'published' | 'publishedTime'} key
 */
function keepPreviousPublicationDate(entry, previousEntry, key) {
  return Number.isFinite(Number(previousEntry[key])) &&
    Number.isFinite(Number(entry[key])) &&
    !hasVolatilePublicationDate(entry) &&
    !hasVolatilePublicationDate(previousEntry) &&
    // RSS feeds report exact dates, so they may replace a scraped estimate
    !(entry.isRSS === true && previousEntry.isRSS !== true)
}

/**
 * Keeps previously-new entries marked and marks unwatched leading entries
 * which were plausibly published since the previous successful channel fetch.
 * Missing caches, old reordered entries, and responses without overlap are not
 * presented as newly published.
 *
 * Publication dates of entries which were already cached are kept, so that
 * refetching a channel doesn't reorder the feed.
 * @param {object[]} entries
 * @param {object[] | null | undefined} previousEntries
 * @param {'videoId' | 'postId'} idKey
 * @param {Date | number | string | null | undefined} previousFetchTimestamp
 * @param {Record<string, object>} [historyById]
 */
export function reconcileFetchedSubscriptionEntries(
  entries,
  previousEntries,
  idKey,
  previousFetchTimestamp,
  historyById = {}
) {
  const previousEntriesById = Array.isArray(previousEntries)
    ? new Map(previousEntries
        .filter(entry => entry[idKey] != null)
        .map(entry => [entry[idKey], entry]))
    : null
  const firstPreviouslyFetchedIndex = previousEntriesById?.size > 0
    ? entries.findIndex(entry => previousEntriesById.has(entry[idKey]))
    : -1
  const previousFetchTime = previousFetchTimestamp == null
    ? Number.NaN
    : new Date(previousFetchTimestamp).getTime()
  const publicationDateKey = idKey === 'postId' ? 'publishedTime' : 'published'

  return entries.map((entry, index) => {
    const publishedTime = Number(entry.published ?? entry.publishedTime)
    const isPlausiblyRecent = Number.isFinite(previousFetchTime) &&
      Number.isFinite(publishedTime) &&
      publishedTime >= previousFetchTime - NEW_CONTENT_PUBLICATION_TOLERANCE_MS
    const isWatched = idKey === 'videoId' && isHistoryEntryWatched(historyById?.[entry[idKey]])
    const previousEntry = previousEntriesById?.get(entry[idKey])
    const wasPreviouslyNew = previousEntry?.isNewInSubscriptionFeed === true
    const isNewlyFetched = firstPreviouslyFetchedIndex > 0 &&
      index < firstPreviouslyFetchedIndex &&
      isPlausiblyRecent

    const reconciledEntry = {
      ...entry,
      isNewInSubscriptionFeed: !isWatched && (wasPreviouslyNew || isNewlyFetched)
    }

    if (previousEntry != null && keepPreviousPublicationDate(entry, previousEntry, publicationDateKey)) {
      reconciledEntry[publicationDateKey] = previousEntry[publicationDateKey]
    }

    return reconciledEntry
  })
}

/**
 * Channel pages return raw entries without New-feed state, while subscription
 * refreshes reconcile that state before updating the cache. Reconcile only the
 * raw entries so opening a channel cannot clear previously-new items.
 * @param {object[]} entries
 * @param {object[] | null | undefined} previousEntries
 * @param {'videoId' | 'postId'} idKey
 * @param {Date | number | string | null | undefined} previousFetchTimestamp
 * @param {Record<string, object>} [historyById]
 */
export function ensureSubscriptionFeedEntryState(
  entries,
  previousEntries,
  idKey,
  previousFetchTimestamp,
  historyById = {}
) {
  if (entries.every(entry => typeof entry.isNewInSubscriptionFeed === 'boolean')) {
    return entries
  }

  return reconcileFetchedSubscriptionEntries(
    entries,
    previousEntries,
    idKey,
    previousFetchTimestamp,
    historyById
  )
}

/**
 * Video ids the RSS premiere lookup has already resolved as "not a premiere",
 * recovered from the caches the subscription refresh persists.
 *
 * Only a `false` verdict is reusable: an upcoming premiere eventually goes
 * live, and entries that were never premiere candidates carry no verdict.
 *
 * @param {Array<Record<string, { videos?: object[] }> | null | undefined>} caches
 *  per-channel caches, keyed by channel id
 * @returns {Set<string>}
 */
export function collectResolvedNonPremiereVideoIds(caches) {
  const videoIds = new Set()

  for (const cache of caches) {
    for (const channelCache of Object.values(cache ?? {})) {
      for (const video of channelCache?.videos ?? []) {
        if (video.isUpcoming === false && video.videoId != null) {
          videoIds.add(video.videoId)
        }
      }
    }
  }

  return videoIds
}
