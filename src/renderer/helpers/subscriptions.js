import store from '../store/index'
import {
  getInvidiousChannelLive,
  getInvidiousChannelVideos,
  invidiousFetch,
  invidiousGetCommunityPosts
} from './api/invidious'
import { getLocalChannelCommunity, getLocalChannelLiveStreams, getLocalChannelVideos } from './api/local'
import {
  copyToClipboard,
  getChannelPlaylistId,
  showToast,
  showToastOnAllTabs
} from './utils'
import { isHistoryEntryWatched } from './history'

const AUTO_REFRESH_TOAST_DURATION = 5000
export const SUBSCRIPTION_REFRESH_COMPLETED_EVENT = 'opentubex-subscription-refresh-completed'
export const SUBSCRIPTION_REFRESH_FINISHED_EVENT = 'opentubex-subscription-refresh-finished'
export const SUBSCRIPTION_REFRESH_LOCK_NAME = 'opentubex-subscription-refresh'
export const SUBSCRIPTION_REFRESH_PROGRESS_EVENT = 'opentubex-subscription-refresh-progress'
export const SUBSCRIPTION_REFRESH_STARTED_EVENT = 'opentubex-subscription-refresh-started'

// The tab id the Electron refresh lock was acquired with. Progress reports to the
// main process must use this id, as the active tab may change during the refresh.
let electronRefreshOwnerTabId = null

const IS_UPCOMING_REGEX = /"isUpcoming"\s*:\s*true/
const SCHEDULED_START_REGEX = /"scheduledStartTime"\s*:\s*"(\d+)"/
const SUBSCRIPTION_FETCH_BATCH_SIZE = 80
const SUBSCRIPTION_FETCH_BATCH_DELAY_MS = 2000
const SUBSCRIPTION_FETCH_CONCURRENCY = 8
// Scraped relative publication dates are approximate, so allow a small amount
// of rounding around the previous fetch without admitting genuinely old items.
const NEW_CONTENT_PUBLICATION_TOLERANCE_MS = 60 * 60 * 1000

/**
 * Marks unwatched leading entries which were plausibly published since the
 * previous successful channel fetch. Missing caches, old reordered entries,
 * and responses without overlap are not presented as newly published.
 * @param {object[]} entries
 * @param {object[] | null | undefined} previousEntries
 * @param {'videoId' | 'postId'} idKey
 * @param {Date | number | string | null | undefined} previousFetchTimestamp
 * @param {Record<string, object>} [historyById]
 */
export function markNewSubscriptionEntries(
  entries,
  previousEntries,
  idKey,
  previousFetchTimestamp,
  historyById = {}
) {
  const previousIds = Array.isArray(previousEntries)
    ? new Set(previousEntries.map(entry => entry[idKey]).filter(id => id != null))
    : null
  const firstPreviouslyFetchedIndex = previousIds?.size > 0
    ? entries.findIndex(entry => previousIds.has(entry[idKey]))
    : -1
  const previousFetchTime = previousFetchTimestamp == null
    ? Number.NaN
    : new Date(previousFetchTimestamp).getTime()

  return entries.map((entry, index) => {
    const publishedTime = Number(entry.published ?? entry.publishedTime)
    const isPlausiblyRecent = Number.isFinite(previousFetchTime) &&
      Number.isFinite(publishedTime) &&
      publishedTime >= previousFetchTime - NEW_CONTENT_PUBLICATION_TOLERANCE_MS
    const isWatched = idKey === 'videoId' && isHistoryEntryWatched(historyById?.[entry[idKey]])

    return {
      ...entry,
      isNewInSubscriptionFeed: firstPreviouslyFetchedIndex > 0 &&
        index < firstPreviouslyFetchedIndex &&
        isPlausiblyRecent &&
        !isWatched
    }
  })
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

  const runRefresh = async () => {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_STARTED_EVENT, {
      detail: { tab, profileId }
    }))

    try {
      return await refresh()
    } finally {
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

async function fetchSubscriptionsConcurrently(channels, fetchChannel) {
  const results = new Array(channels.length)
  let nextIndex = 0

  const fetchNext = async () => {
    while (nextIndex < channels.length) {
      const index = nextIndex++
      results[index] = await fetchChannel(channels[index])

      // Let input and navigation tasks run between parsing/cache updates.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  const workerCount = Math.min(SUBSCRIPTION_FETCH_CONCURRENCY, channels.length)
  await Promise.all(Array.from({ length: workerCount }, fetchNext))

  return results.flat()
}

async function fetchSubscriptionsInBatches(channels, fetchChannel) {
  const results = []

  for (let index = 0; index < channels.length; index += SUBSCRIPTION_FETCH_BATCH_SIZE) {
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
  showToast(`${title}: ${message}`, 10000, () => {
    copyToClipboard(message)
  })
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
 * @param {string} videoId
 */
async function fetchRssVideoUpcomingInfo(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`)

    if (!response.ok) {
      return { isUpcoming: false }
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
    return { isUpcoming: false }
  }
}

/**
 * @param {any} video
 */
async function enrichRssVideoIfNeeded(video) {
  if (!isRssUpcomingPremiereCandidate(video.viewCount)) {
    return video
  }

  const upcomingInfo = await fetchRssVideoUpcomingInfo(video.videoId)

  if (!upcomingInfo.isUpcoming) {
    return {
      ...video,
      isUpcoming: false
    }
  }

  const enrichedVideo = {
    ...video,
    isUpcoming: true
  }

  if (upcomingInfo.premiereDate) {
    enrichedVideo.premiereDate = upcomingInfo.premiereDate
    enrichedVideo.published = upcomingInfo.premiereDate.getTime()
  }

  return enrichedVideo
}

/**
 * Filtering and sort based on user preferences
 * @param {any[]} videos
 */
export function updateVideoListAfterProcessing(videos) {
  let videoList = videos

  if (store.getters.getHideLiveStreams) {
    videoList = videoList.filter(item => {
      return (!item.liveNow && !item.isUpcoming)
    })
  }

  if (store.getters.getHideUpcomingPremieres) {
    videoList = videoList.filter(item => {
      if (isRssUpcomingPremiere(item)) {
        return false
      }

      // Observed for premieres in Local API Subscriptions.
      return (item.premiereDate == null ||
        // Invidious API
        // `premiereTimestamp` only available on premiered videos
        // https://docs.invidious.io/api/common_types/#videoobject
        item.premiereTimestamp == null
      )
    })
  }

  videoList.sort((a, b) => {
    return b.published - a.published
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
      videos: await Promise.all(videos.map(video => enrichRssVideoIfNeeded(video)))
    }
  } catch {
    return {
      videos: []
    }
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
  const activeSubscriptionList = activeProfile.subscriptions
  if (activeSubscriptionList.length === 0) {
    completeSubscriptionRefresh('videos', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Videos'), AUTO_REFRESH_TOAST_DURATION)
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
      setSubscriptionRefreshProgress((channelCount / activeSubscriptionList.length) * 100)

      if (videos != null) {
        const previousCache = store.getters.getVideoCache[channel.id]
        videos = markNewSubscriptionEntries(
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
      }

      if (name || thumbnailUrl) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl
        })
      }

      return videos ?? store.getters.getVideoCache[channel.id]?.videos ?? []
    }

    const videoListFromRemote = useRss
      ? (await Promise.all(activeSubscriptionList.map(fetchChannel))).flat()
      : await fetchSubscriptionsInBatches(activeSubscriptionList, fetchChannel)

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)
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
  const activeSubscriptionList = activeProfile.subscriptions
  if (activeSubscriptionList.length === 0) {
    completeSubscriptionRefresh('shorts', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Shorts'), AUTO_REFRESH_TOAST_DURATION)
  }

  const subscriptionUpdates = []
  let channelCount = 0

  try {
    const videoListFromRemote = (await Promise.all(activeSubscriptionList.map(async (channel) => {
      let videos, name

      if (!process.env.SUPPORTS_LOCAL_API || store.getters.getBackendPreference === 'invidious') {
        ({ videos, name } = await getChannelShortsInvidious(channel, t, errorChannels))
      } else {
        ({ videos, name } = await getChannelShortsLocal(channel, t, errorChannels))
      }

      channelCount++
      setSubscriptionRefreshProgress((channelCount / activeSubscriptionList.length) * 100)

      if (videos != null) {
        const previousCache = store.getters.getShortsCache[channel.id]
        videos = markNewSubscriptionEntries(
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
      }

      if (name) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name
        })
      }

      return videos ?? store.getters.getShortsCache[channel.id]?.videos ?? []
    }))).flat()

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)
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
  const activeSubscriptionList = activeProfile.subscriptions
  if (activeSubscriptionList.length === 0) {
    completeSubscriptionRefresh('live', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Live Streams'), AUTO_REFRESH_TOAST_DURATION)
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
      setSubscriptionRefreshProgress((channelCount / activeSubscriptionList.length) * 100)

      if (videos != null) {
        const previousCache = store.getters.getLiveCache[channel.id]
        videos = markNewSubscriptionEntries(
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
      }

      if (name || thumbnailUrl) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl
        })
      }

      return videos ?? store.getters.getLiveCache[channel.id]?.videos ?? []
    }

    const videoListFromRemote = useRss
      ? (await Promise.all(activeSubscriptionList.map(fetchChannel))).flat()
      : await fetchSubscriptionsInBatches(activeSubscriptionList, fetchChannel)

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)
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
  const activeSubscriptionList = activeProfile.subscriptions
  if (activeSubscriptionList.length === 0) {
    completeSubscriptionRefresh('posts', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Posts'), AUTO_REFRESH_TOAST_DURATION)
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
      posts = markNewSubscriptionEntries(
        posts,
        previousCache?.posts,
        'postId',
        previousCache?.timestamp
      )
      await store.dispatch('updateSubscriptionPostsCacheByChannel', {
        channelId: channel.id,
        posts
      })

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

    const forbiddenTitles = JSON.parse(store.getters.getForbiddenTitles.toLowerCase())
    const filteredPosts = postListFromRemote.filter(post => {
      return !forbiddenTitles.some(text => post.author.toLowerCase().includes(text))
    })

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)
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
      showToast(t('Falling back to Invidious API'))
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
      showToast(t('Falling back to Local API'))
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

    return result
  } catch (err) {
    showSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showToast(t('Falling back to Invidious API'))
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
          showToast(t('Falling back to Invidious API'))
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
          showToast(t('Falling back to Local API'))
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
          showToast(t('Falling back to Local API'))
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

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'))

    if (failedAttempts === 0 && store.getters.getBackendFallback) {
      showToast(t('Falling back to Invidious API'))
      return await getChannelShortsInvidious(channel, t, errorChannels, failedAttempts + 1)
    }

    return { videos: null }
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

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'))

    if (failedAttempts === 0 && process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
      showToast(t('Falling back to Local API'))
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
          showToast(t('Falling back to Invidious API'))
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
          showToast(t('Falling back to Invidious API'))
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
          showToast(t('Falling back to Local API'))
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
          showToast(t('Falling back to Local API'))
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
