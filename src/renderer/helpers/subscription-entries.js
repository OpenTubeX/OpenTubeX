import { isHistoryEntryWatched } from '../../history.js'

// Scraped relative publication dates are approximate, so allow a small amount
// of rounding around the previous fetch without admitting genuinely old items.
const NEW_CONTENT_PUBLICATION_TOLERANCE_MS = 60 * 60 * 1000

/**
 * @param {object} video
 * @returns {number | null}
 */
export function getUpcomingPremiereTimestamp(video) {
  if (video.premiereDate != null) {
    const timestamp = new Date(video.premiereDate).getTime()
    return Number.isNaN(timestamp) ? null : timestamp
  }

  if (video.premiereTimestamp != null) {
    const timestamp = Number(video.premiereTimestamp) * 1000
    return Number.isFinite(timestamp) ? timestamp : null
  }

  return null
}

/**
 * Marks a premiere as live once its scheduled time has arrived.
 * @param {object} video
 * @param {number} now
 */
export function updateUpcomingPremiereState(video, now) {
  const premiereTimestamp = getUpcomingPremiereTimestamp(video)

  if (
    premiereTimestamp != null &&
    premiereTimestamp <= now &&
    (video.isUpcoming || video.premiere || (
      // Local API entries can carry only the scheduled date in older caches.
      video.premiereDate != null &&
      video.isUpcoming == null &&
      video.premiere == null
    ))
  ) {
    return {
      ...video,
      isUpcoming: false,
      premiere: false,
      liveNow: true
    }
  }

  return video
}

/**
 * @param {object} video
 * @param {boolean} showScheduledLiveStreamsFirst
 * @param {number} now
 */
export function getSubscriptionVideoSortTimestamp(video, showScheduledLiveStreamsFirst, now) {
  const scheduledTimestamp = getUpcomingPremiereTimestamp(video)
  const isUpcoming = scheduledTimestamp != null
    ? scheduledTimestamp > now
    : video.isUpcoming === true || video.premiere === true

  if (
    !showScheduledLiveStreamsFirst &&
    isUpcoming &&
    video.subscriptionFeedPublished != null &&
    Number.isFinite(Number(video.subscriptionFeedPublished))
  ) {
    return Number(video.subscriptionFeedPublished)
  }

  return video.published
}

/**
 * Gives pre-setting cache entries a stable announcement position before they
 * are fetched and reconciled again.
 * @param {object} video
 * @param {number} fallbackTimestamp
 * @param {number} now
 */
export function ensureUpcomingSubscriptionFeedPublished(video, fallbackTimestamp, now) {
  const existingTimestamp = Number(video.subscriptionFeedPublished)
  if (video.subscriptionFeedPublished != null && Number.isFinite(existingTimestamp)) {
    return video
  }

  const scheduledTimestamp = getUpcomingPremiereTimestamp(video)
  const isUpcoming = scheduledTimestamp != null
    ? scheduledTimestamp > now
    : video.isUpcoming === true || video.premiere === true
  const timestamp = Number(fallbackTimestamp)

  if (!isUpcoming || !Number.isFinite(timestamp)) {
    return video
  }

  return {
    ...video,
    subscriptionFeedPublished: timestamp
  }
}

/**
 * Adds exact announcement dates supplied by RSS to scraped upcoming entries.
 * @param {object[]} videos
 * @param {object[]} rssVideos
 */
export function mergeUpcomingSubscriptionFeedPublished(videos, rssVideos) {
  const publishedByVideoId = new Map(
    rssVideos
      .filter(video => video.videoId != null && Number.isFinite(Number(video.published)))
      .map(video => [video.videoId, Number(video.published)])
  )

  return videos.map(video => {
    if (video.isUpcoming !== true && video.premiere !== true) {
      return video
    }

    const published = publishedByVideoId.get(video.videoId)
    if (published == null) {
      return video
    }

    return {
      ...video,
      subscriptionFeedPublished: published
    }
  })
}

/**
 * Returns the announcement position used for an upcoming subscription entry.
 * Exact publication dates are preferred; scraper entries fall back to the time
 * they first entered OpenTubeX's subscription cache.
 * @param {object} video
 * @param {number} fallbackTimestamp
 */
function getSubscriptionFeedPublishedTimestamp(video, fallbackTimestamp) {
  if (video.subscriptionFeedPublished == null) {
    return fallbackTimestamp
  }

  const timestamp = Number(video.subscriptionFeedPublished)
  return Number.isFinite(timestamp) ? timestamp : fallbackTimestamp
}

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
    // Exact video metadata must replace Invidious' cached current-time fallback.
    !(entry.isInvidiousPublicationDateEnriched === true &&
      previousEntry.isInvidiousPublicationDateEnriched !== true) &&
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

    if (entry.isUpcoming === true || entry.premiere === true) {
      const scheduledTimestamp = getUpcomingPremiereTimestamp(entry)
      const previousFeedTimestamp = getSubscriptionFeedPublishedTimestamp(previousEntry ?? {}, null)
      const fetchedFeedTimestamp = getSubscriptionFeedPublishedTimestamp(entry, null)

      // Some backends expose the scheduled start as both publication fields.
      // That is not an announcement date, so use first-seen time instead.
      reconciledEntry.subscriptionFeedPublished = [fetchedFeedTimestamp, previousFeedTimestamp]
        .find(timestamp => timestamp != null && timestamp !== scheduledTimestamp) ??
          (Number.isFinite(previousFetchTime) ? previousFetchTime : Date.now())
    }

    if (previousEntry != null && keepPreviousPublicationDate(entry, previousEntry, publicationDateKey)) {
      reconciledEntry[publicationDateKey] = previousEntry[publicationDateKey]
    }

    if (
      entry.isInvidiousPublicationDateFallback === true &&
      previousEntry?.isInvidiousPublicationDateEnriched === true
    ) {
      reconciledEntry.publishedText = previousEntry.publishedText
      reconciledEntry.viewCount = previousEntry.viewCount
      reconciledEntry.viewCountText = previousEntry.viewCountText
      reconciledEntry.isInvidiousPublicationDateEnriched = true
      delete reconciledEntry.isInvidiousPublicationDateFallback
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

/**
 * Applies the outcome of an RSS premiere lookup to an entry.
 *
 * A failed lookup deliberately leaves no verdict behind. The entry is cached
 * as-is, so `collectResolvedNonPremiereVideoIds` will not mistake the failure
 * for a resolved "not a premiere" and the next refresh looks it up again.
 *
 * @param {object} video
 * @param {{ isUpcoming: boolean, failed?: boolean, premiereDate?: Date }} upcomingInfo
 */
export function applyRssPremiereVerdict(video, upcomingInfo) {
  if (upcomingInfo.failed) {
    return video
  }

  if (!upcomingInfo.isUpcoming) {
    return {
      ...video,
      isUpcoming: false
    }
  }

  const enrichedVideo = {
    ...video,
    isUpcoming: true,
    subscriptionFeedPublished: getSubscriptionFeedPublishedTimestamp(video, video.published)
  }

  if (upcomingInfo.premiereDate) {
    enrichedVideo.premiereDate = upcomingInfo.premiereDate
    enrichedVideo.published = upcomingInfo.premiereDate.getTime()
  }

  return enrichedVideo
}
