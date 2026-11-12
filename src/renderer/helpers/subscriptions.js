import { isOnAiSlopList } from './aiSlopList'
import { enrichShortPublicationDates } from './api/short-publication'
import { parseSubscriptionRss, parseRssUpcomingInfo, isRssUpcomingPremiereCandidate } from './api/feed-rss'
import {
  clearSubscriptionChannelErrors,
  isSubscriptionFeedErrorShown,
  setSubscriptionChannelError
} from './subscriptionRefreshErrors'
import { isMissingChannelError } from './channels'
import store from '../store/index'
import { usesInvidiousApi } from '../../apiBackends'
import {
  getInvidiousChannelLive,
  getInvidiousChannelShorts,
  getInvidiousChannelVideos,
  invidiousFetch,
  invidiousGetCommunityPosts,
  invidiousGetVideoInformation
} from './api/invidious'
import { fillYatteeShortDates } from './api/yattee'
import {
  getLocalChannel,
  getLocalChannelCommunity,
  getLocalChannelLiveStreams,
  getLocalChannelVideos,
  getLocalPlaylist,
  localApiFetch,
  parseLocalChannelShorts,
  parseLocalPlaylistVideos
} from './api/local'
import {
  getInvidiousApiErrorMessage,
  showInvidiousFallbackToast,
  getChannelPlaylistId,
  openInternalPath,
  showApiErrorToast,
  showToast,
  showToastOnAllTabs,
} from './utils'
import { getSubscriptionsForFeed } from './subscription-channels'
import {
  applyRssPremiereVerdict,
  collectResolvedNonPremiereVideoIds,
  getSubscriptionVideoSortTimestamp,
  getUpcomingPremiereTimestamp,
  mergeSubscriptionShortThumbnails,
  mergeUpcomingSubscriptionFeedPublished,
  reconcileFetchedSubscriptionEntries,
  updateUpcomingPremiereState
} from './subscription-entries'
import { mapConcurrently } from './concurrent-map'
import { waitUnlessAborted } from './abortable'
import { waitForPlaybackStartup } from './playbackStartup'
import { includeAutomaticDownloadChannels, startAutomaticDownloadsForChannel } from './automaticDownloads'
import { includeNotificationChannels, reportSubscriptionUploads } from './uploadNotifications'
import { extractAssignedJsonObject } from './assigned-json'
import { getInvidiousSubscriptionPremiereUpdate, getLocalSubscriptionPremiereUpdate, shouldRefreshSubscriptionPremiere } from './subscription-premieres'
import { shouldShowProgressStartToast } from './progressPresentation'
import { cancelAndroidSubscriptionRefresh, finishAndroidSubscriptionRefresh, isAndroidSubscriptionRefreshActive } from './androidSubscriptionRefresh'
import { isRecoverableNetworkError } from './networkRecovery'
import { createSubscriptionNetworkRecovery, SubscriptionNetworkError } from './subscriptionNetworkRecovery'
import { buildRequestDiagnostic, formatRequestDiagnostic } from './api/requestDiagnostics'
import {
  canKeepSubscriptionFeedWithoutNewUploads,
  hasNoNewSubscriptionUploads,
  isSubscriptionFeedRecentlyFetched
} from './subscriptionUploadCheck'

const AUTO_REFRESH_TOAST_DURATION = 5000
export const SUBSCRIPTION_REFRESH_CHANNEL_EVENT = 'opentubex-subscription-refresh-channel'
export const SUBSCRIPTION_REFRESH_CANCELLED_EVENT = 'opentubex-subscription-refresh-cancelled'
export const SUBSCRIPTION_REFRESH_COMPLETED_EVENT = 'opentubex-subscription-refresh-completed'
export const SUBSCRIPTION_REFRESH_FINISHED_EVENT = 'opentubex-subscription-refresh-finished'
export const SUBSCRIPTION_REFRESH_LOCK_NAME = 'opentubex-subscription-refresh'
export const SUBSCRIPTION_REFRESH_PROGRESS_EVENT = 'opentubex-subscription-refresh-progress'
export const SUBSCRIPTION_REFRESH_STARTED_EVENT = 'opentubex-subscription-refresh-started'
export const SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY = 'opentubex.subscriptionAutoRefresh.cancel'

// The tab id the Electron refresh lock was acquired with. Progress reports to the
// main process must use this id, as the active tab may change during the refresh.
let electronRefreshOwnerTabId = null

/**
 * Cancellation state of the refresh this renderer is running, if any.
 * `partial` refreshes only fetch some channels again, so they don't count as a refresh of the feed.
 * @type {{ cancelled: boolean, tab: 'videos' | 'shorts' | 'live' | 'posts', profileId: string, refreshId: number, controller: AbortController, errors: Map<string, Map<string, string>>, unavailableChannelIds: Set<string>, newErrorCount: number, partial: boolean, networkRecovery: ReturnType<typeof createSubscriptionNetworkRecovery> | null } | null}
 */
let activeRefresh = null
let nextRefreshId = 0
let rendererRefreshReserved = false

// Incremented on every cancellation request, so that a cancellation is not
// missed when it arrives between two feed refreshes.
let cancelCount = 0

const SUBSCRIPTION_FETCH_BATCH_SIZE = 80
const SUBSCRIPTION_FETCH_BATCH_DELAY_MS = 2000
const SUBSCRIPTION_FETCH_CONCURRENCY = 8
const RSS_ENRICHMENT_CONCURRENCY = 3
const RSS_ENRICHMENT_TIMEOUT_MS = 15_000

/**
 * Channel upload feeds shared by the feed refreshes of one refresh-all.
 * @type {Map<string, Promise<{ videoId: string, published: number, isShort?: boolean }[] | null>> | null}
 */
let sharedChannelUploads = null

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
 * Stops the refresh running in this renderer after the channels that are
 * currently being fetched. Already fetched channels stay cached.
 */
export function cancelSubscriptionRefresh() {
  cancelCount++
  markActiveSubscriptionRefreshCancelled()
  // Native notifications also use this path, without requesting cancellation
  // again. A reopened renderer still needs to postpone its automatic refresh.
  if (process.env.IS_CAPACITOR && !activeRefresh && store.getters.getSubscriptionFeedRefreshInProgress) {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, {
      detail: { tab: store.getters.getSubscriptionFeedRefreshTab, profileId: store.getters.getActiveProfile._id }
    }))
  }
}

function markActiveSubscriptionRefreshCancelled() {
  if (activeRefresh !== null && !activeRefresh.cancelled) {
    activeRefresh.cancelled = true
    activeRefresh.controller.abort()
    activeRefresh.networkRecovery?.cancel()
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, {
      detail: {
        tab: activeRefresh.tab,
        profileId: activeRefresh.profileId
      }
    }))
  }
}

/**
 * Cancels the refresh wherever it is running, as another window may own it.
 */
export function requestSubscriptionRefreshCancellation() {
  cancelSubscriptionRefresh()

  if (process.env.IS_CAPACITOR) {
    cancelAndroidSubscriptionRefresh()
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.subscriptionAutoRefresh.cancel()
    return
  }

  try {
    localStorage.setItem(SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY, `${Date.now()}-${cancelCount}`)
  } catch {
    // Only the refresh of this browser tab can be cancelled then.
  }
}

/**
 * Lets callers that refresh several feeds in a row notice a cancellation that
 * happened between two feeds, when no refresh was running.
 */
export function getSubscriptionRefreshCancelCount() {
  return cancelCount
}

function isRefreshCancelled() {
  return activeRefresh?.cancelled === true
}

/**
 * @template T
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {() => Promise<T>} refresh
 * @param {{ t: (key: string, named?: Record<string, unknown>, plural?: number) => string, channelIds?: string[] | null }} options
 * @returns {Promise<T | null>}
 */
async function withSubscriptionRefreshLock(tab, profileId, refresh, options) {
  // The store only mirrors the shared refresh state, and a progress update of
  // the feed that just finished can still arrive after it. Refresh all would
  // then skip its remaining feeds, so only the actual locks decide.
  if (rendererRefreshReserved) {
    return null
  }

  rendererRefreshReserved = true
  try {
    return await runWithSubscriptionRefreshLock(tab, profileId, refresh, options)
  } finally {
    rendererRefreshReserved = false
  }
}

async function runWithSubscriptionRefreshLock(tab, profileId, refresh, { t, channelIds = null }) {
  if (process.env.IS_CAPACITOR && await isAndroidSubscriptionRefreshActive()) {
    return null
  }

  const cancelCountAtStart = cancelCount
  const refreshId = ++nextRefreshId
  const runRefresh = async () => {
    const controller = new AbortController()
    activeRefresh = {
      cancelled: false,
      errors: new Map(),
      unavailableChannelIds: new Set(),
      newErrorCount: 0,
      partial: channelIds !== null,
      controller,
      tab,
      profileId,
      refreshId,
      networkRecovery: createSubscriptionNetworkRecovery({
        signal: controller.signal,
        allowFallback: process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback
      })
    }
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_STARTED_EVENT, {
      detail: { tab, profileId, refreshId }
    }))

    if (cancelCount !== cancelCountAtStart) {
      markActiveSubscriptionRefreshCancelled()
    }

    try {
      return await refresh()
    } finally {
      activeRefresh.networkRecovery?.cancel()
      notifyNewSubscriptionErrors(activeRefresh, t)
      activeRefresh = null
      window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_FINISHED_EVENT, {
        detail: { tab, profileId, refreshId }
      }))
      if (process.env.IS_CAPACITOR) {
        // Finish native ownership before the next feed checks whether work is busy.
        await finishAndroidSubscriptionRefresh(refreshId)
      }
    }
  }

  if (process.env.IS_ELECTRON) {
    const ownerTabId = store.getters.getActiveTabId
    const acquired = await window.ftElectron.subscriptionAutoRefresh.acquire(ownerTabId, tab)
    if (!acquired) {
      return null
    }

    electronRefreshOwnerTabId = ownerTabId
    try {
      return await runRefresh()
    } finally {
      electronRefreshOwnerTabId = null
      await window.ftElectron.subscriptionAutoRefresh.release(ownerTabId)
    }
  }

  if (navigator.locks) {
    return navigator.locks.request(
      SUBSCRIPTION_REFRESH_LOCK_NAME,
      { ifAvailable: true },
      lock => lock ? runRefresh() : null
    )
  }

  // Without Web Locks, the synchronized state is the only sign of a refresh
  // in another browser tab
  return store.getters.getSubscriptionFeedRefreshInProgress ? null : runRefresh()
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 */
function completeSubscriptionRefresh(tab, profileId) {
  if (activeRefresh?.partial) return
  const timestamp = Date.now()
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, {
    detail: { tab, profileId, timestamp }
  }))
}

/**
 * @param {number} percentage
 */
function setSubscriptionRefreshProgress(percentage) {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, {
    detail: {
      percentage,
      ownerTabId: electronRefreshOwnerTabId,
      refreshId: activeRefresh?.refreshId
    }
  }))
}

/**
 * Lets the feed views render the channels that have been fetched so far,
 * instead of waiting for the whole refresh to finish.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
export function notifySubscriptionChannelRefreshed(tab) {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, {
    detail: { tab }
  }))
}

/**
 * Keeps the channel's errors from this refresh for the error boxes above the feeds,
 * or clears its earlier ones when it loaded.
 * @param {NonNullable<typeof activeRefresh>} refresh
 * @param {{ id: string }} channel
 */
function recordSubscriptionChannelResult(refresh, channel) {
  const messages = refresh.errors.get(channel.id)
  if (!messages?.size) {
    clearSubscriptionChannelErrors(channel.id, [refresh.tab])
    return
  }

  const isNew = setSubscriptionChannelError(channel.id, refresh.tab, {
    reasons: [...new Set(messages.values())],
    trace: [...messages.keys()].join('\n'),
    unavailable: refresh.unavailableChannelIds.has(channel.id)
  })
  if (isNew) refresh.newErrorCount++
}

/**
 * Points to the error box when channels failed for the first time and the
 * user can't see the box already.
 * @param {NonNullable<typeof activeRefresh>} refresh
 * @param {(key: string, named?: Record<string, unknown>, plural?: number) => string} t
 */
function notifyNewSubscriptionErrors(refresh, t) {
  const count = refresh.newErrorCount
  if (refresh.cancelled || count === 0 || isSubscriptionFeedErrorShown(refresh.tab)) return

  showToast({
    message: t('Subscriptions.Channel Errors.Toast', { count }, count),
    icon: ['fas', 'circle-exclamation'],
    action: () => openInternalPath({
      path: '/subscriptions',
      query: { tab: refresh.tab === 'posts' ? 'community' : refresh.tab }
    })
  })
}

// mapConcurrently waits for the channels in flight before it rejects, so the
// refresh, and with it activeRefresh, outlives every worker.
async function fetchSubscriptionsConcurrently(channels, fetchChannel) {
  const refresh = activeRefresh
  const { signal } = refresh.controller
  await mapConcurrently(
    channels,
    SUBSCRIPTION_FETCH_CONCURRENCY,
    async channel => {
      await waitForPlaybackStartup(signal)

      // After a cancellation or failure, channels that haven't started yet are
      // skipped. After a cancellation, the ones in flight still finish and are cached.
      if (signal.aborted) return

      if (process.env.IS_ELECTRON) {
        // A failed or cancelled refresh stops waiting, while the recovery
        // script keeps running for playback.
        await waitUnlessAborted(window.ftElectron.waitForIpBlockRecoveryScript(), signal)
        if (signal.aborted) return
      }

      try {
        if (refresh.networkRecovery) {
          const preferredBackend = store.getters.getBackendPreference
          await refresh.networkRecovery.run(useFallback => {
            if (useFallback && usesInvidiousApi(preferredBackend)) showInvidiousFallbackToast(preferredBackend)
            return fetchChannel(channel, useFallback ? (preferredBackend === 'local' ? 'invidious' : 'local') : preferredBackend)
          })
        } else {
          await fetchChannel(channel)
        }
      } catch (error) {
        if (refresh.cancelled) return
        // Stop the other channels in flight, so the failure is reported
        // without waiting for them to retry or recover.
        refresh.controller.abort()
        refresh.networkRecovery?.cancel()
        throw error
      }

      if (!refresh.cancelled) {
        recordSubscriptionChannelResult(refresh, channel)
      }

      // Let input and navigation tasks run between parsing/cache updates.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  )
}

/**
 * Lets the feed refreshes run by `refresh` share each channel's upload feed.
 * @template T
 * @param {() => Promise<T>} refresh
 * @returns {Promise<T>}
 */
export async function withSharedChannelUploads(refresh) {
  sharedChannelUploads = new Map()
  try {
    return await refresh()
  } finally {
    sharedChannelUploads = null
  }
}

/**
 * Loads the newest uploads of all types from the channel's RSS feed.
 * Resolves to null when the feed is unavailable.
 * @param {string} channelId
 */
function getChannelUploads(channelId) {
  const shared = sharedChannelUploads
  const existing = shared?.get(channelId)
  if (existing) return existing

  const promise = (async () => {
    const response = await localApiFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      signal: activeRefresh?.controller.signal
    })
    return response.status === 200 ? parseSubscriptionRss(await response.text(), channelId).videos : null
  })().catch(() => null)

  if (shared) {
    shared.set(channelId, promise)
    // Let the next feed retry a failed check
    promise.then(uploads => {
      if (uploads === null && shared.get(channelId) === promise) shared.delete(channelId)
    })
  }
  return promise
}

/**
 * With Faster Subscription Refresh, returns the cached entries when they can
 * be kept because the channel's upload feed lists nothing new for them,
 * otherwise null. A failed check
 * falls through to the full fetch, which handles the errors.
 * @param {'videos' | 'shorts' | 'live'} feed
 * @param {string} channelId
 * @param {string} backend
 */
async function getUnchangedSubscriptionFeed(feed, channelId, backend) {
  if (!store.getters.getFastSubscriptionRefresh || !process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backend)) return null

  const getCaches = () => ({
    videos: store.getters.getVideoCache,
    shorts: store.getters.getShortsCache,
    live: store.getters.getLiveCache
  })
  if (!canKeepSubscriptionFeedWithoutNewUploads(getCaches()[feed][channelId], Date.now())) return null

  const uploads = await getChannelUploads(channelId)
  if (uploads === null) return null

  const caches = getCaches()
  const cacheEntry = caches[feed][channelId]
  const knownVideoIds = new Set(Object.values(caches)
    .flatMap(cache => cache[channelId]?.videos ?? [])
    .map(video => video.videoId))
  return canKeepSubscriptionFeedWithoutNewUploads(cacheEntry, Date.now()) &&
    hasNoNewSubscriptionUploads(feed, cacheEntry, uploads, knownVideoIds)
    ? cacheEntry.videos
    : null
}

/**
 * Keeps the cached feed of a channel without new uploads. Automatic downloads
 * and upload notifications still see it, so failed downloads are retried and
 * newly enabled notifications get their baseline as after a full fetch.
 * @param {'videos' | 'shorts' | 'live'} feed
 * @param {{ id: string }} channel
 * @param {string} backend
 * @param {(key: string, named?: Record<string, unknown>) => string} t
 * @returns {Promise<boolean>} Whether the cached feed was kept
 */
async function keepUnchangedSubscriptionFeed(feed, channel, backend, t) {
  const videos = await getUnchangedSubscriptionFeed(feed, channel.id, backend)
  if (videos === null) return false
  await startAutomaticDownloadsForChannel(channel, videos, feed, t, electronRefreshOwnerTabId)
  reportSubscriptionUploads(channel.id, feed, videos)
  return true
}

/**
 * @template {{ id: string }} T
 * @param {T[]} channels
 * @param {string[] | null} channelIds only these channels, or all when null
 * @returns {T[]}
 */
function onlyRequestedChannels(channels, channelIds) {
  return channelIds === null ? channels : channels.filter(channel => channelIds.includes(channel.id))
}

/**
 * With Faster Subscription Refresh, automatic local API refreshes leave out
 * channels fetched moments ago, for example by another window or right before
 * a restart. Automatic downloads and upload notifications still see their
 * cached entries.
 * @template {{ id: string }} T
 * @param {T[]} channels
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feed
 * @param {boolean} automatic
 * @param {(key: string, named?: Record<string, unknown>) => string} t
 * @returns {Promise<T[]>}
 */
async function omitRecentlyFetchedChannels(channels, feed, automatic, t) {
  if (
    !automatic ||
    !store.getters.getFastSubscriptionRefresh ||
    !process.env.SUPPORTS_LOCAL_API ||
    usesInvidiousApi(store.getters.getBackendPreference)
  ) {
    return channels
  }

  const cache = {
    videos: store.getters.getVideoCache,
    shorts: store.getters.getShortsCache,
    live: store.getters.getLiveCache,
    posts: store.getters.getPostsCache
  }[feed]
  const now = Date.now()
  const remaining = []
  for (const channel of channels) {
    const cacheEntry = cache[channel.id]
    if (!isSubscriptionFeedRecentlyFetched(cacheEntry, now)) {
      remaining.push(channel)
      continue
    }
    if (feed === 'posts') {
      reportSubscriptionUploads(channel.id, feed, cacheEntry.posts)
    } else {
      await startAutomaticDownloadsForChannel(channel, cacheEntry.videos, feed, t, electronRefreshOwnerTabId)
      reportSubscriptionUploads(channel.id, feed, cacheEntry.videos)
    }
  }
  return remaining
}

/**
 * Pauses between batches in proportion to the channels that were fetched in
 * full, so channels kept unchanged after their upload check add no delay.
 * @param {{ id: string }[]} channels
 * @param {(channel: any, backend?: string) => Promise<unknown>} fetchChannel Resolves to false when it kept the cached feed
 */
async function fetchSubscriptionsInBatches(channels, fetchChannel) {
  let fetchedInBatch = 0
  const countFetch = async (channel, backend) => {
    const result = await fetchChannel(channel, backend)
    if (result !== false) fetchedInBatch++
    return result
  }

  for (let index = 0; index < channels.length; index += SUBSCRIPTION_FETCH_BATCH_SIZE) {
    if (isRefreshCancelled()) {
      break
    }

    if (fetchedInBatch > 0) {
      const delay = SUBSCRIPTION_FETCH_BATCH_DELAY_MS * Math.min(fetchedInBatch / SUBSCRIPTION_FETCH_BATCH_SIZE, 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    fetchedInBatch = 0
    const batch = channels.slice(index, index + SUBSCRIPTION_FETCH_BATCH_SIZE)
    await fetchSubscriptionsConcurrently(batch, countFetch)
  }
}

// Routine fallback notices stay quiet during bulk refreshes. Direct retries use
// showInvidiousFallbackToast so privacy warnings remain visible.
function showSubscriptionFallbackToast(options) {
  if (!activeRefresh) showToast(options)
}

/**
 * @param {{ id: string, name?: string }} channel
 * @param {unknown} error
 * @param {string} title
 * @param {{ category: string, backend: string }} context
 * @param {boolean} [unavailable] the channel does not exist anymore or was terminated
 */
function handleSubscriptionFetchError(channel, error, title, context, unavailable = isMissingChannelError(error)) {
  if (activeRefresh?.controller.signal.aborted) throw error
  if (activeRefresh?.networkRecovery && isRecoverableNetworkError(error)) {
    // Let the shared queue probe both enabled backends after backoff without
    // cache writes, completion timestamps, or one toast per subscribed channel.
    throw new SubscriptionNetworkError(error)
  }

  const channelLabel = channel.name ? `${channel.name} (${channel.id})` : channel.id
  const details = buildRequestDiagnostic(error, context)
  const diagnostic = formatRequestDiagnostic(details)
  const message = `${channelLabel}: ${diagnostic}`

  console.error(`Failed to fetch subscription channel ${channelLabel}: ${diagnostic}`)
  if (activeRefresh) {
    if (!activeRefresh.errors.has(channel.id)) activeRefresh.errors.set(channel.id, new Map())
    activeRefresh.errors.get(channel.id).set(message, details.message)
    if (unavailable) activeRefresh.unavailableChannelIds.add(channel.id)
  } else {
    showApiErrorToast(title, message)
  }
}

/**
 * @param {{
 *  isRSS?: boolean,
 *  isUpcoming?: boolean,
 *  viewCount?: number | string | null,
 * }} video
 */
export function isRssUpcomingPremiere(video) {
  if (!video?.isRSS) {
    return false
  }

  if (video.isUpcoming === true) {
    return true
  }

  if (video.isUpcoming === false) {
    return false
  }

  // Fallback for cached RSS entries before enrichment.
  return isRssUpcomingPremiereCandidate(video.viewCount)
}

/**
 * @param {object} video
 * @param {number} [now]
 */
export function isUpcomingPremiere(video, now = Date.now()) {
  const premiereTimestamp = getUpcomingPremiereTimestamp(video)

  if (premiereTimestamp != null) {
    return premiereTimestamp > now
  }

  return isRssUpcomingPremiere(video)
}

/**
 * @param {object} video
 * @param {{
 *  hideLiveStreams?: boolean,
 *  hideUpcomingPremieres?: boolean,
 *  hideChannelsBasedOnText?: boolean,
 *  hiddenChannelNames?: Set<string>,
 *  aiSlopChannels?: Set<string>,
 *  forbiddenTitles?: string[],
 *  membersOnlyChannelIds?: Set<string> | null,
 * }} preferences
 */
export function isVideoHiddenByPreferences(video, {
  hideLiveStreams = false,
  hideUpcomingPremieres = false,
  hideChannelsBasedOnText = true,
  hiddenChannelNames = new Set(),
  aiSlopChannels = new Set(),
  forbiddenTitles = [],
  membersOnlyChannelIds = null
} = {}) {
  if (hideLiveStreams && (video.liveNow || video.isUpcoming)) {
    return true
  }

  if (
    hideUpcomingPremieres &&
    isUpcomingPremiere(video)
  ) {
    return true
  }

  if (
    hiddenChannelNames.has(video.authorId) ||
    hiddenChannelNames.has(video.author) ||
    video.collaborators?.some(({ id }) => hiddenChannelNames.has(id))
  ) {
    return true
  }

  if (isOnAiSlopList(aiSlopChannels, video)) {
    return true
  }

  if (
    membersOnlyChannelIds != null &&
    video.isMembersOnly === true &&
    !membersOnlyChannelIds.has(video.authorId) &&
    !membersOnlyChannelIds.has(video.collaborators?.[0]?.id)
  ) {
    return true
  }

  if (forbiddenTitles.length === 0) return false

  const lowerCaseAuthor = video.author?.toLowerCase()
  const lowerCaseTitle = video.title?.toLowerCase()

  return forbiddenTitles.some(text =>
    lowerCaseTitle?.includes(text) ||
      (hideChannelsBasedOnText && lowerCaseAuthor?.includes(text))
  )
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
    const signal = AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS)

    // Like the premiere poller, only contact YouTube directly with the local API
    if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(store.getters.getBackendPreference)) {
      const response = await invidiousFetch(`${store.getters.getApiServerUrl}/api/v1/videos/${encodeURIComponent(videoId)}`, signal)
      const video = response.ok ? await response.json() : null
      if (video?.videoId !== videoId) {
        return { isUpcoming: false, failed: true }
      }
      if (video.isUpcoming !== true) {
        return { isUpcoming: false }
      }
      return {
        isUpcoming: true,
        premiereDate: video.premiereTimestamp > 0 ? new Date(video.premiereTimestamp * 1000) : undefined
      }
    }

    const response = await localApiFetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        signal,
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

/**
 * Filtering and sort based on user preferences
 * @param {any[]} videos
 */
export function updateVideoListAfterProcessing(videos, now = Date.now()) {
  let videoList = videos.map(video => updateUpcomingPremiereState(video, now))

  if (store.getters.getHideLiveStreams) {
    videoList = videoList.filter(item => {
      return (!item.liveNow && !item.isUpcoming)
    })
  }

  if (store.getters.getHideUpcomingPremieres) {
    videoList = videoList.filter(item => !isUpcomingPremiere(item, now))
  }

  const showScheduledLiveStreamsFirst = store.getters.getShowScheduledLiveStreamsFirst

  videoList.sort((a, b) => {
    return getSubscriptionVideoSortTimestamp(b, showScheduledLiveStreamsFirst, now) -
      getSubscriptionVideoSortTimestamp(a, showScheduledLiveStreamsFirst, now)
  })

  return videoList
}

/**
 * @param {string} rssString
 * @param {string} channelId
 */
export async function parseYouTubeRSSFeed(rssString, channelId) {
  // A body that is not a feed (consent page, bot challenge, truncated response)
  // must surface as an error so the caller keeps the cached entries and falls
  // back, instead of treating it as a channel without videos.
  const { name: channelName, videos } = process.env.IS_ELECTRON
    ? await window.ftElectron.subscriptionAutoRefresh.processFeed({ format: 'rss', text: rssString, channelId })
        .catch(() => parseSubscriptionRss(rssString, channelId))
    : parseSubscriptionRss(rssString, channelId)

  return {
    name: channelName,
    // Enrichment downloads a watch page per candidate, so cap how many of them
    // a single channel can have in flight at once.
    videos: await enrichSubscriptionRssEntries(videos)
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
 * Only needed when scheduled entries stay at their announcement position.
 * @param {string} channelId
 * @param {object[]} videos
 */
async function enrichScrapedUpcomingPublicationDates(channelId, videos) {
  if (
    store.getters.getShowScheduledLiveStreamsFirst ||
    !videos.some(video => video.isUpcoming === true || video.premiere === true)
  ) {
    return videos
  }

  try {
    const response = await localApiFetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      {
        // Cancelling the refresh must not wait for this optional lookup.
        signal: AbortSignal.any([
          AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS),
          ...(activeRefresh ? [activeRefresh.controller.signal] : [])
        ]),
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

/**
 * @param {{
 *  t: (key: string, named?: Record<string, unknown>) => string,
 *  showStartToast?: boolean,
 *  automatic?: boolean,
 *  channelIds?: string[] | null
 * }} options
 */
export function refreshSubscriptionVideosFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'videos',
    activeProfile._id,
    () => refreshSubscriptionVideosFromRemoteUnlocked(options, activeProfile),
    options
  )
}

async function refreshSubscriptionVideosFromRemoteUnlocked({
  t,
  showStartToast = false,
  channelIds = null,
  automatic = false
}, activeProfile) {
  const activeSubscriptionList = getSubscriptionsForFeed(activeProfile.subscriptions, 'videos')
  const subscriptionList = await omitRecentlyFetchedChannels(
    onlyRequestedChannels(includeNotificationChannels(includeAutomaticDownloadChannels(activeSubscriptionList, 'videos'), 'videos'), channelIds),
    'videos',
    automatic,
    t
  )
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('videos', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && shouldShowProgressStartToast(store.getters.getEffectiveShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Videos'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0
  const useRss = store.getters.getUseRssFeeds

  try {
    const fetchChannel = async (channel, backend = store.getters.getBackendPreference) => {
      if (await keepUnchangedSubscriptionFeed('videos', channel, backend, t)) {
        channelCount++
        setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)
        return false
      }

      let videos, name, thumbnailUrl, handle

      if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backend)) {
        if (useRss && hasInvidiousRssFeeds()) {
          ({ videos, name, thumbnailUrl, handle } = await getChannelVideosInvidiousRSS(channel, t))
        } else {
          ({ videos, name, thumbnailUrl, handle } = await getChannelVideosInvidiousScraper(channel, t))
        }
      } else {
        if (useRss) {
          ({ videos, name, thumbnailUrl, handle } = await getChannelVideosLocalRSS(channel, t))
        } else {
          ({ videos, name, thumbnailUrl, handle } = await getChannelVideosLocalScraper(channel, t))
        }
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)

      if (videos != null) {
        activeRefresh.errors.delete(channel.id)
        const previousCache = store.getters.getVideoCache[channel.id]
        videos = reconcileFetchedSubscriptionEntries(
          videos,
          previousCache?.videos,
          'videoId',
          previousCache?.timestamp,
          store.getters.getHistoryCacheById
        )
        await store.dispatch('updateSubscriptionVideosCacheByChannel', {
          channelId: channel.id,
          videos
        })
        await startAutomaticDownloadsForChannel(channel, videos, 'videos', t, electronRefreshOwnerTabId)
        reportSubscriptionUploads(channel.id, 'videos', videos)
        notifySubscriptionChannelRefreshed('videos')
      }

      if (name || thumbnailUrl || handle) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl,
          channelHandle: handle
        })
      }
    }

    if (useRss) {
      await fetchSubscriptionsConcurrently(subscriptionList, fetchChannel)
    } else {
      await fetchSubscriptionsInBatches(subscriptionList, fetchChannel)
    }

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('videos', activeProfile._id)

    return []
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

/**
 * @param {{
 *  t: (key: string, named?: Record<string, unknown>) => string,
 *  showStartToast?: boolean,
 *  automatic?: boolean,
 *  channelIds?: string[] | null
 * }} options
 */
export function refreshSubscriptionShortsFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'shorts',
    activeProfile._id,
    () => refreshSubscriptionShortsFromRemoteUnlocked(options, activeProfile),
    options
  )
}

async function refreshSubscriptionShortsFromRemoteUnlocked({
  t,
  showStartToast = false,
  channelIds = null,
  automatic = false
}, activeProfile) {
  const activeSubscriptionList = getSubscriptionsForFeed(activeProfile.subscriptions, 'shorts')
  const subscriptionList = await omitRecentlyFetchedChannels(
    onlyRequestedChannels(includeNotificationChannels(includeAutomaticDownloadChannels(activeSubscriptionList, 'shorts'), 'shorts'), channelIds),
    'shorts',
    automatic,
    t
  )
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('shorts', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && shouldShowProgressStartToast(store.getters.getEffectiveShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Shorts'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0

  try {
    await fetchSubscriptionsConcurrently(subscriptionList, async (channel, backend = store.getters.getBackendPreference) => {
      if (await keepUnchangedSubscriptionFeed('shorts', channel, backend, t)) {
        channelCount++
        setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)
        return false
      }

      let videos, name

      if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backend)) {
        ({ videos, name } = hasInvidiousRssFeeds()
          ? await getChannelShortsInvidious(channel, t)
          : await getChannelShortsYattee(channel, t))
      } else {
        ({ videos, name } = await getChannelShortsLocal(channel, t))
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)

      if (videos != null) {
        activeRefresh.errors.delete(channel.id)
        const previousCache = store.getters.getShortsCache[channel.id]
        videos = reconcileFetchedSubscriptionEntries(
          videos,
          previousCache?.videos,
          'videoId',
          previousCache?.timestamp,
          store.getters.getHistoryCacheById
        )
        await store.dispatch('updateSubscriptionShortsCacheByChannel', {
          channelId: channel.id,
          videos
        })
        await startAutomaticDownloadsForChannel(channel, videos, 'shorts', t, electronRefreshOwnerTabId)
        reportSubscriptionUploads(channel.id, 'shorts', videos)
        notifySubscriptionChannelRefreshed('shorts')
      }

      if (name) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name
        })
      }
    })

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('shorts', activeProfile._id)

    return []
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

/**
 * @param {{
 *  t: (key: string, named?: Record<string, unknown>) => string,
 *  showStartToast?: boolean,
 *  automatic?: boolean,
 *  channelIds?: string[] | null
 * }} options
 */
export function refreshSubscriptionLiveFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'live',
    activeProfile._id,
    () => refreshSubscriptionLiveFromRemoteUnlocked(options, activeProfile),
    options
  )
}

async function refreshSubscriptionLiveFromRemoteUnlocked({
  t,
  showStartToast = false,
  channelIds = null,
  automatic = false
}, activeProfile) {
  const activeSubscriptionList = getSubscriptionsForFeed(activeProfile.subscriptions, 'live')
  const subscriptionList = await omitRecentlyFetchedChannels(
    onlyRequestedChannels(includeNotificationChannels(includeAutomaticDownloadChannels(activeSubscriptionList, 'live'), 'live'), channelIds),
    'live',
    automatic,
    t
  )
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('live', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && shouldShowProgressStartToast(store.getters.getEffectiveShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Live Streams'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0
  const useRss = store.getters.getUseRssFeeds

  try {
    const fetchChannel = async (channel, backend = store.getters.getBackendPreference) => {
      if (await keepUnchangedSubscriptionFeed('live', channel, backend, t)) {
        channelCount++
        setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)
        return false
      }

      let videos, name, thumbnailUrl, handle

      if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backend)) {
        if (useRss && hasInvidiousRssFeeds()) {
          ({ videos, name, thumbnailUrl, handle } = await getChannelLiveInvidiousRSS(channel, t))
        } else {
          ({ videos, name, thumbnailUrl, handle } = await getChannelLiveInvidious(channel, t))
        }
      } else {
        if (useRss) {
          ({ videos, name, thumbnailUrl, handle } = await getChannelLiveLocalRSS(channel, t))
        } else {
          ({ videos, name, thumbnailUrl, handle } = await getChannelLiveLocal(channel, t))
        }
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)

      if (videos != null) {
        activeRefresh.errors.delete(channel.id)
        const previousCache = store.getters.getLiveCache[channel.id]
        videos = reconcileFetchedSubscriptionEntries(
          videos,
          previousCache?.videos,
          'videoId',
          previousCache?.timestamp,
          store.getters.getHistoryCacheById
        )
        await store.dispatch('updateSubscriptionLiveCacheByChannel', {
          channelId: channel.id,
          videos
        })
        await startAutomaticDownloadsForChannel(channel, videos, 'live', t, electronRefreshOwnerTabId)
        reportSubscriptionUploads(channel.id, 'live', videos)
        notifySubscriptionChannelRefreshed('live')
      }

      if (name || thumbnailUrl || handle) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl,
          channelHandle: handle
        })
      }
    }

    if (useRss) {
      await fetchSubscriptionsConcurrently(subscriptionList, fetchChannel)
    } else {
      await fetchSubscriptionsInBatches(subscriptionList, fetchChannel)
    }

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('live', activeProfile._id)

    return []
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

/**
 * @param {{
 *  t: (key: string, named?: Record<string, unknown>) => string,
 *  showStartToast?: boolean,
 *  automatic?: boolean,
 *  channelIds?: string[] | null
 * }} options
 */
export function refreshSubscriptionPostsFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'posts',
    activeProfile._id,
    () => refreshSubscriptionPostsFromRemoteUnlocked(options, activeProfile),
    options
  )
}

async function refreshSubscriptionPostsFromRemoteUnlocked({
  t,
  showStartToast = false,
  channelIds = null,
  automatic = false
}, activeProfile) {
  const subscriptionList = await omitRecentlyFetchedChannels(
    onlyRequestedChannels(includeNotificationChannels(getSubscriptionsForFeed(activeProfile.subscriptions, 'posts'), 'posts'), channelIds),
    'posts',
    automatic,
    t
  )
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('posts', activeProfile._id)
    return []
  }

  // Yattee servers have no posts, so only the local API fallback can load them
  if (store.getters.getBackendPreference === 'yattee') {
    if (!process.env.SUPPORTS_LOCAL_API || !store.getters.getBackendFallback) {
      completeSubscriptionRefresh('posts', activeProfile._id)
      return []
    }
    showInvidiousFallbackToast('yattee')
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && shouldShowProgressStartToast(store.getters.getEffectiveShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Posts'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0

  try {
    const processChannel = async (channel, backend = store.getters.getBackendPreference) => {
      let posts

      if (backend === 'yattee') {
        // Yattee servers have no posts, so only the fallback can load them
        posts = await getChannelPostsLocal(channel, t)
      } else if (!process.env.SUPPORTS_LOCAL_API || backend === 'invidious') {
        posts = await getChannelPostsInvidious(channel, t)
      } else {
        posts = await getChannelPostsLocal(channel, t)
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)

      if (posts === null) return
      activeRefresh.errors.delete(channel.id)
      const previousCache = store.getters.getPostsCache[channel.id]
      posts = reconcileFetchedSubscriptionEntries(
        posts,
        previousCache?.posts,
        'postId',
        previousCache?.timestamp
      )
      await store.dispatch('updateSubscriptionPostsCacheByChannel', {
        channelId: channel.id,
        posts
      })
      reportSubscriptionUploads(channel.id, 'posts', posts)
      notifySubscriptionChannelRefreshed('posts')

      const channelPost = posts.find(post => post.authorId === channel.id)
      if (channelPost) {
        let thumbnailUrl = channelPost.authorThumbnails?.[0]?.url

        if (thumbnailUrl?.startsWith('//')) {
          thumbnailUrl = 'https:' + thumbnailUrl
        }

        if (channelPost.author || thumbnailUrl) {
          subscriptionUpdates.push({
            channelId: channel.id,
            channelName: channelPost.author,
            channelThumbnailUrl: thumbnailUrl
          })
        }
      }
    }

    await fetchSubscriptionsInBatches(subscriptionList, processChannel)

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('posts', activeProfile._id)

    return []
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

/**
 * Fetches the given feeds of a single channel again.
 * @param {string} channelId
 * @param {('videos' | 'shorts' | 'live' | 'posts')[]} feeds
 * @param {(key: string, named?: Record<string, unknown>) => string} t
 */
export async function retrySubscriptionChannel(channelId, feeds, t) {
  const refreshers = {
    videos: refreshSubscriptionVideosFromRemote,
    shorts: refreshSubscriptionShortsFromRemote,
    live: refreshSubscriptionLiveFromRemote,
    posts: refreshSubscriptionPostsFromRemote
  }
  for (const feed of feeds) {
    // Cancelled, or another refresh is running
    if (await refreshers[feed]({ t, channelIds: [channelId] }) === null) return
  }
}

async function getChannelPostsLocal(channel, t) {
  try {
    const posts = await getLocalChannelCommunity(channel.id, activeRefresh?.controller.signal)

    if (posts === null) {
      handleSubscriptionFetchError(channel, new Error('Channel unavailable'), t('Local API Error (Click to copy)'), {
        category: 'subscription posts',
        backend: 'local API'
      }, true)
      return null
    }

    return posts
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'), {
      category: 'subscription posts',
      backend: 'local API'
    })

    if (store.getters.getBackendPreference === 'local' && store.getters.getBackendFallback) {
      showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelPostsInvidious(channel, t)
    }

    return null
  }
}

async function getChannelPostsInvidious(channel, t) {
  try {
    const result = await invidiousGetCommunityPosts(channel.id, null, activeRefresh?.controller.signal)

    return result.posts
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Invidious API Error (Click to copy)'), {
      category: 'subscription posts',
      backend: 'Invidious API'
    })

    if (
      process.env.SUPPORTS_LOCAL_API &&
      store.getters.getBackendPreference === 'invidious' &&
      store.getters.getBackendFallback
    ) {
      showInvidiousFallbackToast('invidious')
      return await getChannelPostsLocal(channel, t)
    }

    return null
  }
}

async function getChannelVideosLocalScraper(channel, t, failedAttempts = 0) {
  try {
    const result = await getLocalChannelVideos(channel.id, false, activeRefresh?.controller.signal)

    if (result === null) {
      handleSubscriptionFetchError(channel, new Error('Channel unavailable'), t('Local API Error (Click to copy)'), {
        category: 'subscription videos',
        backend: 'local API'
      }, true)
      return { videos: null }
    }

    return {
      ...result,
      videos: await enrichScrapedUpcomingPublicationDates(channel.id, result.videos)
    }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'), {
      category: 'subscription videos',
      backend: 'local API'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalRSS(channel, t, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosInvidiousScraper(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosLocalRSS(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

/** Reject HTTP failures before trying to parse an error page as RSS. */
function checkSubscriptionFeedResponse(response) {
  if (response.status >= 400) {
    const error = new Error(`Subscription feed returned HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
}

async function getChannelVideosLocalRSS(channel, t, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await localApiFetch(feedUrl, { signal: activeRefresh?.controller.signal })

    if (response.status === 404) {
      // RSS can return 404 for channels that still exist. Verify through
      // the API instead of treating a second RSS response as channel removal.
      return await getChannelVideosLocalScraper(channel, t, 3)
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'), {
      category: 'subscription videos',
      backend: 'YouTube RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalScraper(channel, t, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosInvidiousRSS(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosLocalScraper(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelVideosInvidiousScraper(channel, t, failedAttempts = 0) {
  try {
    const result = await getInvidiousChannelVideos(channel.id, undefined, undefined, { signal: activeRefresh?.controller.signal })
    let name

    if (result.videos.length > 0) {
      name = result.videos.find(video => video.type === 'video' && video.author)?.author
    }

    return {
      name,
      videos: result.videos
    }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, getInvidiousApiErrorMessage(store.getters.getBackendPreference), {
      category: 'subscription videos',
      backend: 'Invidious API'
    })

    if (!hasInvidiousRssFeeds()) {
      if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
        showInvidiousFallbackToast('yattee')
        // Skips the local API's own fallback to Invidious
        return await getChannelVideosLocalScraper(channel, t, 2)
      }
      return { videos: null }
    }

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousRSS(channel, t, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelVideosLocalScraper(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosInvidiousRSS(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelVideosInvidiousRSS(channel, t, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl, activeRefresh?.controller.signal)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET',
        signal: activeRefresh?.controller.signal
      })

      if (response2.status === 404) {
        handleSubscriptionFetchError(channel, Object.assign(new Error('Subscription feed returned HTTP 404'), { status: 404 }), t('Invidious API Error (Click to copy)'), {
          category: 'subscription videos',
          backend: 'Invidious RSS'
        }, true)
        return { videos: null }
      }

      checkSubscriptionFeedResponse(response2)
      return { videos: [] }
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'), {
      category: 'subscription videos',
      backend: 'Invidious RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousScraper(channel, t, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelVideosLocalRSS(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosInvidiousScraper(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelShortsLocal(channel, t, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await localApiFetch(feedUrl, { signal: activeRefresh?.controller.signal })

    if (response.status === 404) {
      const channelPage = await getLocalChannel(channel.id, activeRefresh?.controller.signal)
      if (channelPage.alert) {
        handleSubscriptionFetchError(channel, new Error(String(channelPage.alert)), t('Local API Error (Click to copy)'), {
          category: 'subscription Shorts',
          backend: 'local API'
        }, true)
        return { videos: null }
      }
      if (!channelPage.has_shorts) return { videos: [] }
      try {
        const playlist = await getLocalPlaylist(playlistId, activeRefresh?.controller.signal)
        const videos = parseLocalPlaylistVideos(playlist.items)
        videos.forEach(video => {
          video.isShort = true
          // Shorts playlist entries can omit the channel byline.
          if (video.author == null || video.author === 'N/A') {
            video.author = channel.name
          }
          video.authorId ??= channel.id
        })
        // A playlist lists up to 100 Shorts, so only date those that can be new.
        await fillLocalShortDates(videos, channel.id, true)
        return { videos }
      } catch (error) {
        if (error.message !== 'The playlist does not exist.') throw error
        // Some channels have Shorts even though their automatic playlist is missing.
        const shortsTab = await channelPage.getShorts()
        const videos = parseLocalChannelShorts(shortsTab.videos, channel.id, channel.name)
        await fillLocalShortDates(videos, channel.id)
        return { videos }
      }
    }

    checkSubscriptionFeedResponse(response)
    const [result, thumbnailEntries] = await Promise.all([
      parseYouTubeRSSFeed(await response.text(), channel.id),
      getLocalShortThumbnailEntries(playlistId)
    ])
    result.videos = mergeSubscriptionShortThumbnails(result.videos, thumbnailEntries)
    result.videos.forEach(video => { video.isShort = true })
    return result
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'), {
      category: 'subscription Shorts',
      backend: 'YouTube RSS'
    })

    if (failedAttempts === 0 && store.getters.getBackendFallback) {
      showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelShortsInvidious(channel, t, failedAttempts + 1)
    }

    return { videos: null }
  }
}

/**
 * Shorts playlists and tabs omit publication dates, which subscriptions need
 * for sorting and New badges: undated entries can never be marked as new.
 * Cached dates are reused and the rest are loaded from watch pages. With
 * `newOnly`, only entries ahead of the first cached one are loaded, as only
 * those can become new (see reconcileFetchedSubscriptionEntries).
 * @param {any[]} videos
 * @param {string} channelId
 * @param {boolean} [newOnly]
 */
async function fillLocalShortDates(videos, channelId, newOnly = false) {
  const cachedDates = new Map((store.getters.getShortsCache[channelId]?.videos ?? [])
    .map(entry => [entry.videoId, entry.published]))
  const firstCachedIndex = videos.findIndex(video => cachedDates.has(video.videoId))
  const fetchLimit = !newOnly ? videos.length : Math.max(firstCachedIndex, 0)
  // One missing date fails the channel, so stop the other lookups too.
  const lookups = new AbortController()
  await mapConcurrently(videos, RSS_ENRICHMENT_CONCURRENCY, async (video, index) => {
    if (Number.isFinite(video.published)) return
    const cached = cachedDates.get(video.videoId)
    if (Number.isFinite(cached)) {
      video.published = cached
      return
    }
    if (index >= fetchLimit) return
    const response = await localApiFetch(`https://www.youtube.com/watch?v=${video.videoId}`, {
      signal: AbortSignal.any([
        activeRefresh?.controller.signal,
        lookups.signal,
        AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS)
      ].filter(Boolean)),
      nativeTimeoutMs: RSS_ENRICHMENT_TIMEOUT_MS
    })
    checkSubscriptionFeedResponse(response)
    const player = JSON.parse(extractAssignedJsonObject(await response.text(), 'ytInitialPlayerResponse') ?? 'null')
    const published = Date.parse(player?.microformat?.playerMicroformatRenderer?.publishDate)
    if (player?.videoDetails?.videoId !== video.videoId || !Number.isFinite(published)) {
      throw new Error(`Could not load the publication date for Short ${video.videoId}`)
    }
    video.published = published
  }).catch(error => {
    lookups.abort()
    throw error
  })
}

async function getLocalShortThumbnailEntries(playlistId) {
  try {
    const playlist = await getLocalPlaylist(playlistId, activeRefresh?.controller.signal)
    return parseLocalPlaylistVideos(playlist.items)
  } catch (error) {
    console.warn(`Failed to load selected Shorts thumbnails for ${playlistId}`, error)
    return []
  }
}

/** Yattee servers have no RSS feeds, so their API is used instead. */
function hasInvidiousRssFeeds() {
  return store.getters.getBackendPreference !== 'yattee'
}

async function getChannelShortsYattee(channel, t) {
  try {
    const result = await getInvidiousChannelShorts(channel.id)
    return { videos: await fillYatteeShortDates(result.videos, store.getters.getShortsCache[channel.id]?.videos, invidiousGetVideoInformation) }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, getInvidiousApiErrorMessage('yattee'), {
      category: 'subscription Shorts',
      backend: 'Yattee API'
    })

    if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
      showInvidiousFallbackToast('yattee')
      // Skips the local API's own fallback to Invidious
      return await getChannelShortsLocal(channel, t, 1)
    }

    return { videos: null }
  }
}

async function getChannelShortsInvidious(channel, t, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl, activeRefresh?.controller.signal)

    if (response.status === 404) {
      // As the local API's fallback, a missing playlist means the fallback
      // failed too, not that the channel has no Shorts. Keep the cached ones.
      if (failedAttempts > 0) return { videos: null }
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET',
        signal: activeRefresh?.controller.signal
      })

      if (response2.status === 404) {
        handleSubscriptionFetchError(channel, Object.assign(new Error('Subscription feed returned HTTP 404'), { status: 404 }), t('Invidious API Error (Click to copy)'), {
          category: 'subscription Shorts',
          backend: 'Invidious RSS'
        }, true)
        return { videos: null }
      }

      checkSubscriptionFeedResponse(response2)
      return { videos: [] }
    }

    checkSubscriptionFeedResponse(response)
    const result = await parseYouTubeRSSFeed(await response.text(), channel.id)
    result.videos.forEach(video => { video.isShort = true })
    return result
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'), {
      category: 'subscription Shorts',
      backend: 'Invidious RSS'
    })

    if (failedAttempts === 0 && process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
      showInvidiousFallbackToast('invidious')
      return await getChannelShortsLocal(channel, t, failedAttempts + 1)
    }

    return { videos: null }
  }
}

async function getChannelLiveLocal(channel, t, failedAttempts = 0) {
  try {
    const result = await getLocalChannelLiveStreams(channel.id, activeRefresh?.controller.signal)

    if (result === null) {
      handleSubscriptionFetchError(channel, new Error('Channel unavailable'), t('Local API Error (Click to copy)'), {
        category: 'subscription live streams',
        backend: 'local API'
      }, true)
      return { videos: null }
    }

    return {
      ...result,
      videos: await enrichScrapedUpcomingPublicationDates(channel.id, result.videos)
    }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'), {
      category: 'subscription live streams',
      backend: 'local API'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveLocalRSS(channel, t, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveInvidious(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveLocalRSS(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelLiveLocalRSS(channel, t, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'live', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await localApiFetch(feedUrl, { signal: activeRefresh?.controller.signal })

    if (response.status === 404) {
      return await getChannelLiveLocal(channel, t, 3)
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'), {
      category: 'subscription live streams',
      backend: 'YouTube RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveLocal(channel, t, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveInvidiousRSS(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveLocal(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelLiveInvidious(channel, t, failedAttempts = 0) {
  try {
    const result = await getInvidiousChannelLive(channel.id, undefined, undefined, activeRefresh?.controller.signal)
    let name

    if (result.videos.length > 0) {
      name = result.videos.find(video => video.type === 'video' && video.author)?.author
    }

    return {
      name,
      videos: result.videos
    }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, getInvidiousApiErrorMessage(store.getters.getBackendPreference), {
      category: 'subscription live streams',
      backend: 'Invidious API'
    })

    if (!hasInvidiousRssFeeds()) {
      if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
        showInvidiousFallbackToast('yattee')
        // Skips the local API's own fallback to Invidious
        return await getChannelLiveLocal(channel, t, 2)
      }
      return { videos: null }
    }

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveInvidiousRSS(channel, t, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelLiveLocal(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveInvidiousRSS(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelLiveInvidiousRSS(channel, t, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'live', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl, activeRefresh?.controller.signal)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET',
        signal: activeRefresh?.controller.signal
      })

      if (response2.status === 404) {
        handleSubscriptionFetchError(channel, Object.assign(new Error('Subscription feed returned HTTP 404'), { status: 404 }), t('Invidious API Error (Click to copy)'), {
          category: 'subscription live streams',
          backend: 'Invidious RSS'
        }, true)
        return { videos: null }
      }

      checkSubscriptionFeedResponse(response2)
      return { videos: [] }
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'), {
      category: 'subscription live streams',
      backend: 'Invidious RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveInvidious(channel, t, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelLiveLocalRSS(channel, t, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveInvidious(channel, t, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}
