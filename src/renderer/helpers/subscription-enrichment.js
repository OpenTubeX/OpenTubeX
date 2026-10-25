import { enrichShortPublicationDates } from './api/short-publication'
import { parseRssUpcomingInfo, isRssUpcomingPremiereCandidate } from './api/feed-rss'
import store from '../store/index'
import { usesInvidiousApi } from '../../apiBackends'
import { invidiousFetch } from './api/invidious'
import { localApiFetch } from './api/local'
import { getSubscriptionsForFeed } from './subscription-channels'
import {
  applyRssPremiereVerdict,
  collectResolvedNonPremiereVideoIds,
  mergeUpcomingSubscriptionFeedPublished,
} from './subscription-entries'
import { mapConcurrently } from './concurrent-map'
import { getInvidiousSubscriptionPremiereUpdate, getLocalSubscriptionPremiereUpdate, shouldRefreshSubscriptionPremiere } from './subscription-premieres'
import { notifySubscriptionChannelRefreshed } from './subscription-refresh-state'

export const RSS_ENRICHMENT_CONCURRENCY = 3
export const RSS_ENRICHMENT_TIMEOUT_MS = 15_000

/**
 * Refresh only due premieres, preserving the channel's full-refresh timestamp
 * and any newer cache data written while the request was in flight.
 * @param {() => boolean} isActive
 */
export async function refreshSubscriptionPremieres(isActive) {
  if (!store.getters.getSubscriptionCacheReady || store.getters.getSubscriptionFeedRefreshInProgress) return
  const profile = store.getters.getActiveProfile
  const channels = getSubscriptionsForFeed(profile.subscriptions, 'videos')
  for (const channel of channels) {
    if (!isActive() || store.getters.getActiveProfile._id !== profile._id) return
    const cache = store.getters.getVideoCache[channel.id]
    const entries = cache?.videos
    const candidates = entries?.filter(video => shouldRefreshSubscriptionPremiere(video, Date.now())) ?? []
    if (candidates.length === 0) continue
    const updates = new Map()
    await mapConcurrently(candidates, RSS_ENRICHMENT_CONCURRENCY, async video => {
      if (!isActive()) return
      try {
        const options = { signal: AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS) }
        let update
        if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(store.getters.getBackendPreference)) {
          const url = `${store.getters.getApiServerUrl}/api/v1/videos/${encodeURIComponent(video.videoId)}`
          const response = await invidiousFetch(url, options.signal)
          if (!response.ok) return
          update = getInvidiousSubscriptionPremiereUpdate(await response.json(), video.videoId)
        } else {
          const response = await localApiFetch(`https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`, {
            ...options,
            headers: { 'Accept-Language': 'en-US' },
            nativeTimeoutMs: RSS_ENRICHMENT_TIMEOUT_MS
          })
          if (!response.ok) return
          update = getLocalSubscriptionPremiereUpdate(await response.text(), video.videoId)
        }
        if (update !== null) updates.set(video.videoId, update)
      } catch {
        // Keep the last known state and retry on the next poll.
      }
    })
    if (!isActive() || store.getters.getActiveProfile._id !== profile._id) return
    if (updates.size === 0 || store.getters.getVideoCache[channel.id]?.videos !== entries ||
      store.getters.getSubscriptionFeedRefreshInProgress) continue
    await store.dispatch('updateSubscriptionVideosCacheByChannel', {
      channelId: channel.id,
      videos: entries.map(video => updates.has(video.videoId) ? { ...video, ...updates.get(video.videoId) } : video),
      timestamp: cache.timestamp
    })
    notifySubscriptionChannelRefreshed('videos')
  }
}

/**
 * Video ids already known not to be premieres. Each lookup downloads a full
 * watch page and every refresh re-parses the same RSS entries, so without this
 * the same new uploads would be fetched again on every refresh. Only negative
 * results are cached: a video that isn't a premiere never becomes one, whereas
 * an upcoming premiere does eventually go live.
 * @type {Set<string>}
 */
const rssNonPremiereVideoIds = new Set()
/** @type {Map<string, Promise<{ isUpcoming: boolean, failed?: boolean, isPremiere?: boolean, premiereDate?: Date }>>} */
const rssUpcomingInfoRequests = new Map()

let rssNonPremiereVideoIdsSeeded = false

/**
 * The set above only lives as long as the window, so every start used to
 * re-download a watch page for each recent upload that still reads as
 * 0 views - hundreds of them across a large subscription list. Enrichment
 * already writes its verdict into the entries the subscription cache
 * persists, so recover it from there instead of asking YouTube again.
 *
 * Runs once, on the first enrichment after the cache has loaded.
 */
function seedRssNonPremiereVideoIds() {
  if (rssNonPremiereVideoIdsSeeded || !store.getters.getSubscriptionCacheReady) {
    return
  }

  rssNonPremiereVideoIdsSeeded = true

  const resolved = collectResolvedNonPremiereVideoIds([
    store.getters.getVideoCache,
    store.getters.getShortsCache,
    store.getters.getLiveCache
  ])

  for (const videoId of resolved) {
    rssNonPremiereVideoIds.add(videoId)
  }
}

/**
 * @param {string} videoId
 */
function fetchRssVideoUpcomingInfo(videoId) {
  seedRssNonPremiereVideoIds()

  if (rssNonPremiereVideoIds.has(videoId)) {
    return Promise.resolve({ isUpcoming: false })
  }

  const inFlight = rssUpcomingInfoRequests.get(videoId)
  if (inFlight !== undefined) {
    return inFlight
  }

  const request = fetchRssVideoUpcomingInfoUncached(videoId).then((info) => {
    // A failed lookup says nothing about the video, so let the next refresh retry.
    if (!info.isUpcoming && !info.failed) {
      rssNonPremiereVideoIds.add(videoId)
    }
    return info
  }).finally(() => {
    rssUpcomingInfoRequests.delete(videoId)
  })

  rssUpcomingInfoRequests.set(videoId, request)
  return request
}

/**
 * @param {string} videoId
 */
async function fetchRssVideoUpcomingInfoUncached(videoId) {
  try {
    // Bounded because the enrichment workers await these one at a time: a
    // request that never settles would hold its worker forever, leaving the
    // channel's feed permanently unresolved. A timeout counts as a failed
    // lookup, so it is not cached and the next refresh tries again.
    const response = await localApiFetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        signal: AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS),
        nativeTimeoutMs: RSS_ENRICHMENT_TIMEOUT_MS,
      }
    )

    if (!response.ok) {
      return { isUpcoming: false, failed: true }
    }

    return parseRssUpcomingInfo(await response.text())
  } catch {
    return { isUpcoming: false, failed: true }
  }
}

/**
 * @param {any} video
 */
async function enrichRssVideoIfNeeded(video) {
  if (!isRssUpcomingPremiereCandidate(video.viewCount)) {
    return video
  }

  return applyRssPremiereVerdict(video, await fetchRssVideoUpcomingInfo(video.videoId))
}

/** Restore missing Local Shorts dates before importing native background results. */
export function enrichSubscriptionShortDates(entries, channelId) {
  return enrichShortPublicationDates(entries, async videoId => {
    const response = await localApiFetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      signal: AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS),
      nativeTimeoutMs: RSS_ENRICHMENT_TIMEOUT_MS
    })
    checkSubscriptionFeedResponse(response)
    return response.text()
  }, store.getters.getShortsCache[channelId]?.videos ?? [])
}

/** Enrich imported RSS entries using the same cache and limits as foreground refreshes. */
export function enrichSubscriptionRssEntries(entries) {
  return mapConcurrently(entries, RSS_ENRICHMENT_CONCURRENCY, entry =>
    entry.isRSS && entry.isUpcoming == null ? enrichRssVideoIfNeeded(entry) : entry)
}

/** Reject HTTP failures before trying to parse an error page as RSS. */
export function checkSubscriptionFeedResponse(response) {
  if (response.status >= 400) {
    const error = new Error(`Subscription feed returned HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
}

/**
 * Parses only the exact publication metadata needed to position scraped
 * upcoming entries. Unlike the full RSS parser, this performs no watch-page
 * enrichment.
 * @param {string} rssString
 */
function parseYouTubeRSSPublicationDates(rssString) {
  try {
    const xmlDom = new DOMParser().parseFromString(rssString, 'application/xml')

    return Array.from(xmlDom.querySelectorAll('entry'), entry => ({
      videoId: entry.getElementsByTagName('yt:videoId')[0]?.textContent,
      published: Date.parse(entry.querySelector('published')?.textContent)
    }))
  } catch {
    return []
  }
}

/**
 * @param {string} channelId
 * @param {object[]} videos
 */
export async function enrichScrapedUpcomingPublicationDates(channelId, videos) {
  if (!videos.some(video => video.isUpcoming === true || video.premiere === true)) {
    return videos
  }

  try {
    const response = await localApiFetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      {
        signal: AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS),
        nativeTimeoutMs: RSS_ENRICHMENT_TIMEOUT_MS,
      }
    )

    if (!response.ok) {
      return videos
    }

    const rssVideos = parseYouTubeRSSPublicationDates(await response.text())
    return mergeUpcomingSubscriptionFeedPublished(videos, rssVideos)
  } catch {
    return videos
  }
}
