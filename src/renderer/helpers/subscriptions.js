import store from '../store/index'
import {
  getInvidiousChannelLive,
  getInvidiousChannelVideos,
  invidiousFetch,
  invidiousGetCommunityPosts
} from './api/invidious'
import {
  getLocalChannelCommunity,
  getLocalChannelLiveStreams,
  getLocalChannelVideos,
  getLocalPlaylist,
  parseLocalPlaylistVideos
} from './api/local'
import {
  fetchWithTimeout,
  getChannelPlaylistId,
  showApiErrorToast,
  showToast,
  showToastOnAllTabs,
} from './utils'
import { getValidSubscriptionChannels } from './subscription-channels'
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
import { includeAutomaticDownloadChannels, startAutomaticDownloadsForChannel } from './automaticDownloads'

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
 * @type {{ cancelled: boolean, tab: string, profileId: string } | null}
 */
let activeRefresh = null

// Incremented on every cancellation request, so that a cancellation is not
// missed when it arrives between two feed refreshes.
let cancelCount = 0

const IS_UPCOMING_REGEX = /"isUpcoming"\s*:\s*true/
const SCHEDULED_START_REGEX = /"scheduledStartTime"\s*:\s*"(\d+)"/
const SUBSCRIPTION_FETCH_BATCH_SIZE = 80
const SUBSCRIPTION_FETCH_BATCH_DELAY_MS = 2000
const SUBSCRIPTION_FETCH_CONCURRENCY = 8
const RSS_ENRICHMENT_CONCURRENCY = 3
const RSS_ENRICHMENT_TIMEOUT_MS = 15_000

/**
 * Stops the refresh running in this renderer after the channels that are
 * currently being fetched. Already fetched channels stay cached.
 */
export function cancelSubscriptionRefresh() {
  cancelCount++
  markActiveSubscriptionRefreshCancelled()
}

function markActiveSubscriptionRefreshCancelled() {
  if (activeRefresh !== null && !activeRefresh.cancelled) {
    activeRefresh.cancelled = true
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
 * @returns {Promise<T | null>}
 */
async function withSubscriptionRefreshLock(tab, profileId, refresh) {
  if (store.getters.getSubscriptionFeedRefreshInProgress) {
    return null
  }

  const cancelCountAtStart = cancelCount
  const runRefresh = async () => {
    activeRefresh = { cancelled: false, tab, profileId }
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_STARTED_EVENT, {
      detail: { tab, profileId }
    }))

    if (cancelCount !== cancelCountAtStart) {
      markActiveSubscriptionRefreshCancelled()
    }

    try {
      return await refresh()
    } finally {
      activeRefresh = null
      window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_FINISHED_EVENT, {
        detail: { tab, profileId }
      }))
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

  return runRefresh()
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 */
function completeSubscriptionRefresh(tab, profileId) {
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
    detail: { percentage, ownerTabId: electronRefreshOwnerTabId }
  }))
}

/**
 * Lets the feed views render the channels that have been fetched so far,
 * instead of waiting for the whole refresh to finish.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function notifySubscriptionChannelRefreshed(tab) {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, {
    detail: { tab }
  }))
}

async function fetchSubscriptionsConcurrently(channels, fetchChannel) {
  const results = await mapConcurrently(
    channels,
    SUBSCRIPTION_FETCH_CONCURRENCY,
    async channel => {
      // Channels that haven't started yet are skipped, the ones in flight
      // still finish and are cached.
      if (isRefreshCancelled()) {
        return []
      }

      if (process.env.IS_ELECTRON) {
        await window.ftElectron.waitForIpBlockRecoveryScript()
      }

      const result = await fetchChannel(channel)

      // Let input and navigation tasks run between parsing/cache updates.
      await new Promise(resolve => setTimeout(resolve, 0))

      return result
    }
  )

  return results.flat()
}

async function fetchSubscriptionsInBatches(channels, fetchChannel) {
  const results = []

  for (let index = 0; index < channels.length; index += SUBSCRIPTION_FETCH_BATCH_SIZE) {
    if (isRefreshCancelled()) {
      break
    }

    if (index > 0) {
      await new Promise(resolve => setTimeout(resolve, SUBSCRIPTION_FETCH_BATCH_DELAY_MS))
    }

    const batch = channels.slice(index, index + SUBSCRIPTION_FETCH_BATCH_SIZE)
    results.push(...await fetchSubscriptionsConcurrently(batch, fetchChannel))
  }

  return results
}

/**
 * @param {{ id: string, name?: string }} channel
 * @param {unknown} error
 * @param {string} title
 */
export function showSubscriptionFetchError(channel, error, title) {
  const channelLabel = channel.name ? `${channel.name} (${channel.id})` : channel.id
  const message = `${channelLabel}: ${error}`

  console.error(`Failed to fetch subscription channel ${channelLabel}`, error)
  showApiErrorToast(title, message)
}

/**
 * @param {number | string | null | undefined} viewCount
 */
function getNumericViewCount(viewCount) {
  if (viewCount == null) {
    return null
  }

  const numericViewCount = typeof viewCount === 'string' ? parseInt(viewCount, 10) : viewCount

  return Number.isNaN(numericViewCount) ? null : numericViewCount
}

/**
 * RSS feeds don't expose premiere status directly. Upcoming premieres usually have
 * very low view counts, so we only look up metadata for those entries.
 * @param {number | string | null | undefined} viewCount
 */
function isRssUpcomingPremiereCandidate(viewCount) {
  const numericViewCount = getNumericViewCount(viewCount)

  return numericViewCount != null && numericViewCount <= 1
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
 *  hiddenChannelNames?: Set<string>,
 *  forbiddenTitles?: string[],
 * }} preferences
 */
export function isVideoHiddenByPreferences(video, {
  hideLiveStreams = false,
  hideUpcomingPremieres = false,
  hiddenChannelNames = new Set(),
  forbiddenTitles = []
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

  if (hiddenChannelNames.has(video.authorId) || hiddenChannelNames.has(video.author)) {
    return true
  }

  const lowerCaseAuthor = video.author?.toLowerCase()
  const lowerCaseTitle = video.title?.toLowerCase()

  return forbiddenTitles.some(text =>
    lowerCaseAuthor?.includes(text) || lowerCaseTitle?.includes(text)
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
/** @type {Map<string, Promise<{ isUpcoming: boolean, premiereDate?: Date }>>} */
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
    const response = await fetchWithTimeout(
      RSS_ENRICHMENT_TIMEOUT_MS,
      `https://www.youtube.com/watch?v=${videoId}`
    )

    if (!response.ok) {
      return { isUpcoming: false, failed: true }
    }

    const html = await response.text()
    const isUpcoming = IS_UPCOMING_REGEX.test(html)

    if (!isUpcoming) {
      return { isUpcoming: false }
    }

    const scheduledStartMatch = html.match(SCHEDULED_START_REGEX)
    const premiereDate = scheduledStartMatch
      ? new Date(parseInt(scheduledStartMatch[1], 10) * 1000)
      : undefined

    return {
      isUpcoming: true,
      premiereDate
    }
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
  // doesn't need to be asynchronous, but doing it allows us to do the relatively slow DOM querying in parallel
  try {
    const xmlDom = new DOMParser().parseFromString(rssString, 'application/xml')
    const channelName = xmlDom.querySelector('author > name').textContent
    const entries = xmlDom.querySelectorAll('entry')

    const promises = []

    for (const entry of entries) {
      promises.push(parseRSSEntry(entry, channelId, channelName))
    }

    const videos = await Promise.all(promises)

    return {
      name: channelName,
      // Enrichment downloads a watch page per candidate, so cap how many of them
      // a single channel can have in flight at once.
      videos: await mapConcurrently(videos, RSS_ENRICHMENT_CONCURRENCY, enrichRssVideoIfNeeded)
    }
  } catch {
    return {
      videos: []
    }
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
async function enrichScrapedUpcomingPublicationDates(channelId, videos) {
  if (!videos.some(video => video.isUpcoming === true || video.premiere === true)) {
    return videos
  }

  try {
    const response = await fetchWithTimeout(
      RSS_ENRICHMENT_TIMEOUT_MS,
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
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
 *  errorChannels?: any[]
 * }} options
 */
export function refreshSubscriptionVideosFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'videos',
    activeProfile._id,
    () => refreshSubscriptionVideosFromRemoteUnlocked(options, activeProfile)
  )
}

async function refreshSubscriptionVideosFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const activeSubscriptionList = getValidSubscriptionChannels(activeProfile.subscriptions)
  const activeSubscriptionIds = new Set(activeSubscriptionList.map(channel => channel.id))
  const subscriptionList = includeAutomaticDownloadChannels(activeSubscriptionList, 'videos')
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('videos', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && !store.getters.getShowProgressBarToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Videos'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0
  const useRss = store.getters.getUseRssFeeds

  try {
    const fetchChannel = async (channel) => {
      let videos, name, thumbnailUrl

      if (!process.env.SUPPORTS_LOCAL_API || store.getters.getBackendPreference === 'invidious') {
        if (useRss) {
          ({ videos, name, thumbnailUrl } = await getChannelVideosInvidiousRSS(channel, t, errorChannels))
        } else {
          ({ videos, name, thumbnailUrl } = await getChannelVideosInvidiousScraper(channel, t, errorChannels))
        }
      } else {
        if (useRss) {
          ({ videos, name, thumbnailUrl } = await getChannelVideosLocalRSS(channel, t, errorChannels))
        } else {
          ({ videos, name, thumbnailUrl } = await getChannelVideosLocalScraper(channel, t, errorChannels))
        }
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)

      if (videos != null) {
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
        await startAutomaticDownloadsForChannel(channel, videos, 'videos', t)
        notifySubscriptionChannelRefreshed('videos')
      }

      if (name || thumbnailUrl) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl
        })
      }

      const channelVideos = videos ?? store.getters.getVideoCache[channel.id]?.videos ?? []
      return activeSubscriptionIds.has(channel.id) ? channelVideos : []
    }

    const videoListFromRemote = useRss
      ? await fetchSubscriptionsConcurrently(subscriptionList, fetchChannel)
      : await fetchSubscriptionsInBatches(subscriptionList, fetchChannel)

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('videos', activeProfile._id)

    return updateVideoListAfterProcessing(videoListFromRemote)
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

/**
 * @param {{
 *  t: (key: string, named?: Record<string, unknown>) => string,
 *  showStartToast?: boolean,
 *  errorChannels?: any[]
 * }} options
 */
export function refreshSubscriptionShortsFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'shorts',
    activeProfile._id,
    () => refreshSubscriptionShortsFromRemoteUnlocked(options, activeProfile)
  )
}

async function refreshSubscriptionShortsFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const activeSubscriptionList = getValidSubscriptionChannels(activeProfile.subscriptions)
  const activeSubscriptionIds = new Set(activeSubscriptionList.map(channel => channel.id))
  const subscriptionList = includeAutomaticDownloadChannels(activeSubscriptionList, 'shorts')
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('shorts', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && !store.getters.getShowProgressBarToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Shorts'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0

  try {
    const videoListFromRemote = await fetchSubscriptionsConcurrently(subscriptionList, async (channel) => {
      let videos, name

      if (!process.env.SUPPORTS_LOCAL_API || store.getters.getBackendPreference === 'invidious') {
        ({ videos, name } = await getChannelShortsInvidious(channel, t, errorChannels))
      } else {
        ({ videos, name } = await getChannelShortsLocal(channel, t, errorChannels))
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)

      if (videos != null) {
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
        await startAutomaticDownloadsForChannel(channel, videos, 'shorts', t)
        notifySubscriptionChannelRefreshed('shorts')
      }

      if (name) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name
        })
      }

      const channelVideos = videos ?? store.getters.getShortsCache[channel.id]?.videos ?? []
      return activeSubscriptionIds.has(channel.id) ? channelVideos : []
    })

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('shorts', activeProfile._id)

    return updateVideoListAfterProcessing(videoListFromRemote)
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

/**
 * @param {{
 *  t: (key: string, named?: Record<string, unknown>) => string,
 *  showStartToast?: boolean,
 *  errorChannels?: any[]
 * }} options
 */
export function refreshSubscriptionLiveFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'live',
    activeProfile._id,
    () => refreshSubscriptionLiveFromRemoteUnlocked(options, activeProfile)
  )
}

async function refreshSubscriptionLiveFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const activeSubscriptionList = getValidSubscriptionChannels(activeProfile.subscriptions)
  const activeSubscriptionIds = new Set(activeSubscriptionList.map(channel => channel.id))
  const subscriptionList = includeAutomaticDownloadChannels(activeSubscriptionList, 'live')
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('live', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && !store.getters.getShowProgressBarToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Live Streams'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0
  const useRss = store.getters.getUseRssFeeds

  try {
    const fetchChannel = async (channel) => {
      let videos, name, thumbnailUrl

      if (!process.env.SUPPORTS_LOCAL_API || store.getters.getBackendPreference === 'invidious') {
        if (useRss) {
          ({ videos, name, thumbnailUrl } = await getChannelLiveInvidiousRSS(channel, t, errorChannels))
        } else {
          ({ videos, name, thumbnailUrl } = await getChannelLiveInvidious(channel, t, errorChannels))
        }
      } else {
        if (useRss) {
          ({ videos, name, thumbnailUrl } = await getChannelLiveLocalRSS(channel, t, errorChannels))
        } else {
          ({ videos, name, thumbnailUrl } = await getChannelLiveLocal(channel, t, errorChannels))
        }
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / subscriptionList.length) * 100)

      if (videos != null) {
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
        await startAutomaticDownloadsForChannel(channel, videos, 'live', t)
        notifySubscriptionChannelRefreshed('live')
      }

      if (name || thumbnailUrl) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl
        })
      }

      const channelVideos = videos ?? store.getters.getLiveCache[channel.id]?.videos ?? []
      return activeSubscriptionIds.has(channel.id) ? channelVideos : []
    }

    const videoListFromRemote = useRss
      ? await fetchSubscriptionsConcurrently(subscriptionList, fetchChannel)
      : await fetchSubscriptionsInBatches(subscriptionList, fetchChannel)

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('live', activeProfile._id)

    return updateVideoListAfterProcessing(videoListFromRemote)
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

/**
 * @param {{
 *  t: (key: string, named?: Record<string, unknown>) => string,
 *  showStartToast?: boolean,
 *  errorChannels?: any[]
 * }} options
 */
export function refreshSubscriptionPostsFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'posts',
    activeProfile._id,
    () => refreshSubscriptionPostsFromRemoteUnlocked(options, activeProfile)
  )
}

async function refreshSubscriptionPostsFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const activeSubscriptionList = getValidSubscriptionChannels(activeProfile.subscriptions)
  if (activeSubscriptionList.length === 0) {
    completeSubscriptionRefresh('posts', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && !store.getters.getShowProgressBarToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Posts'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  const postListFromRemote = []
  let channelCount = 0

  try {
    const processChannel = async (channel) => {
      let posts

      if (!process.env.SUPPORTS_LOCAL_API || store.getters.getBackendPreference === 'invidious') {
        posts = await getChannelPostsInvidious(channel, t, errorChannels)
      } else {
        posts = await getChannelPostsLocal(channel, t, errorChannels)
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / activeSubscriptionList.length) * 100)

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

      return posts
    }

    postListFromRemote.push(...await fetchSubscriptionsInBatches(activeSubscriptionList, processChannel))

    postListFromRemote.sort((a, b) => b.publishedTime - a.publishedTime)

    const forbiddenTitles = store.getters.getForbiddenTitlesParsed
    const filteredPosts = postListFromRemote.filter(post => {
      return !forbiddenTitles.some(text => post.author.toLowerCase().includes(text))
    })

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)

    if (isRefreshCancelled()) {
      return null
    }

    completeSubscriptionRefresh('posts', activeProfile._id)

    return filteredPosts
  } finally {
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

async function getChannelPostsLocal(channel, t, errorChannels) {
  try {
    const posts = await getLocalChannelCommunity(channel.id)

    if (posts === null) {
      errorChannels.push(channel)
      return []
    }

    return posts
  } catch (err) {
    showSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'))

    if (store.getters.getBackendPreference === 'local' && store.getters.getBackendFallback) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelPostsInvidious(channel, t, errorChannels)
    }

    return []
  }
}

async function getChannelPostsInvidious(channel, t, errorChannels) {
  try {
    const result = await invidiousGetCommunityPosts(channel.id)

    return result.posts
  } catch (err) {
    showSubscriptionFetchError(channel, err, t('Invidious API Error (Click to copy)'))

    if (
      process.env.SUPPORTS_LOCAL_API &&
      store.getters.getBackendPreference === 'invidious' &&
      store.getters.getBackendFallback
    ) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelPostsLocal(channel, t, errorChannels)
    }

    return []
  }
}

async function getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getLocalChannelVideos(channel.id)

    if (result === null) {
      errorChannels.push(channel)
      return { videos: null }
    }

    return {
      ...result,
      videos: store.getters.getShowScheduledLiveStreamsFirst
        ? result.videos
        : await enrichScrapedUpcomingPublicationDates(channel.id, result.videos)
    }
  } catch (err) {
    showSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await fetch(feedUrl)

    if (response.status === 403) {
      return { videos: null }
    }

    if (response.status === 404) {
      const response2 = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, {
        method: 'HEAD'
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        return { videos: null }
      }

      return { videos: [] }
    }

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getInvidiousChannelVideos(channel.id)
    let name

    if (result.videos.length > 0) {
      name = result.videos.find(video => video.type === 'video' && video.author).author
    }

    return {
      name,
      videos: result.videos
    }
  } catch (err) {
    showSubscriptionFetchError(channel, err, t('Invidious API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET'
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        return { videos: null }
      }

      return { videos: [] }
    }

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelShortsLocal(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await fetch(feedUrl)

    if (response.status === 403) {
      return { videos: null }
    }

    if (response.status === 404) {
      const response2 = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, {
        method: 'HEAD'
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        return { videos: null }
      }

      return { videos: [] }
    }

    const [result, thumbnailEntries] = await Promise.all([
      parseYouTubeRSSFeed(await response.text(), channel.id),
      getLocalShortThumbnailEntries(playlistId)
    ])
    result.videos = mergeSubscriptionShortThumbnails(result.videos, thumbnailEntries)
    result.videos.forEach(video => { video.isShort = true })
    return result
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'))

    if (failedAttempts === 0 && store.getters.getBackendFallback) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelShortsInvidious(channel, t, errorChannels, failedAttempts + 1)
    }

    return { videos: null }
  }
}

async function getLocalShortThumbnailEntries(playlistId) {
  try {
    const playlist = await getLocalPlaylist(playlistId)
    return parseLocalPlaylistVideos(playlist.items)
  } catch (error) {
    console.warn(`Failed to load selected Shorts thumbnails for ${playlistId}`, error)
    return []
  }
}

async function getChannelShortsInvidious(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET'
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        return { videos: null }
      }

      return { videos: [] }
    }

    const result = await parseYouTubeRSSFeed(await response.text(), channel.id)
    result.videos.forEach(video => { video.isShort = true })
    return result
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'))

    if (failedAttempts === 0 && process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelShortsLocal(channel, t, errorChannels, failedAttempts + 1)
    }

    return { videos: null }
  }
}

async function getChannelLiveLocal(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getLocalChannelLiveStreams(channel.id)

    if (result === null) {
      errorChannels.push(channel)
      return { videos: null }
    }

    return result
  } catch (err) {
    showSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveInvidious(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'live', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await fetch(feedUrl)

    if (response.status === 403) {
      return { videos: null }
    }

    if (response.status === 404) {
      const response2 = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, {
        method: 'HEAD'
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        return { videos: null }
      }

      return { videos: [] }
    }

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveLocal(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveLocal(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelLiveInvidious(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getInvidiousChannelLive(channel.id)
    let name

    if (result.videos.length > 0) {
      name = result.videos.find(video => video.type === 'video' && video.author).author
    }

    return {
      name,
      videos: result.videos
    }
  } catch (err) {
    showSubscriptionFetchError(channel, err, t('Invidious API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveLocal(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

async function getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'live', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET'
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        return { videos: null }
      }

      return { videos: [] }
    }

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveInvidious(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveInvidious(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

/**
 * @param {Element} entry
 * @param {string} channelId
 * @param {string} channelName
 */
async function parseRSSEntry(entry, channelId, channelName) {
  // doesn't need to be asynchronous, but doing it allows us to do the relatively slow DOM querying in parallel

  const rawViewCount = entry.getElementsByTagName('media:statistics')[0]?.getAttribute('views')

  let viewCount = null

  if (rawViewCount) {
    const parsedViewCount = parseInt(rawViewCount)

    if (!isNaN(parsedViewCount)) {
      viewCount = parsedViewCount
    }
  }

  return {
    authorId: channelId,
    author: channelName,
    // querySelector doesn't support xml namespaces so we have to use getElementsByTagName here
    videoId: entry.getElementsByTagName('yt:videoId')[0].textContent,
    title: entry.querySelector('title').textContent,
    published: Date.parse(entry.querySelector('published').textContent),
    viewCount,
    type: 'video',
    lengthSeconds: '0:00',
    isRSS: true
  }
}
