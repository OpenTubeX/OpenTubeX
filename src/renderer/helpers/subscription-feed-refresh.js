import store from '../store/index'
import { usesInvidiousApi } from '../../apiBackends'
import {
  showInvidiousFallbackToast,
  showToastOnAllTabs,
} from './utils'
import { getSubscriptionsForFeed } from './subscription-channels'
import { reconcileFetchedSubscriptionEntries } from './subscription-entries'
import { includeAutomaticDownloadChannels, startAutomaticDownloadsForChannel } from './automaticDownloads'
import { includeNotificationChannels, reportSubscriptionUploads } from './uploadNotifications'
import { shouldShowProgressStartToast } from './progressPresentation'
import {
  activeRefresh,
  completeSubscriptionRefresh,
  electronRefreshOwnerTabId,
  fetchSubscriptionsConcurrently,
  fetchSubscriptionsInBatches,
  isRefreshCancelled,
  notifySubscriptionChannelRefreshed,
  setSubscriptionRefreshProgress,
  withSubscriptionRefreshLock,
} from './subscription-refresh-state'
import {
  getChannelLiveInvidious,
  getChannelLiveInvidiousRSS,
  getChannelLiveLocal,
  getChannelLiveLocalRSS,
  getChannelPostsInvidious,
  getChannelPostsLocal,
  getChannelShortsInvidious,
  getChannelShortsLocal,
  getChannelShortsYattee,
  getChannelVideosInvidiousRSS,
  getChannelVideosInvidiousScraper,
  getChannelVideosLocalRSS,
  getChannelVideosLocalScraper,
  hasInvidiousRssFeeds,
} from './subscription-channel-feeds'

const AUTO_REFRESH_TOAST_DURATION = 5000

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
    () => refreshSubscriptionVideosFromRemoteUnlocked(options, activeProfile),
    options.t
  )
}

async function refreshSubscriptionVideosFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const activeSubscriptionList = getSubscriptionsForFeed(activeProfile.subscriptions, 'videos')
  const subscriptionList = includeNotificationChannels(includeAutomaticDownloadChannels(activeSubscriptionList, 'videos'), 'videos')
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('videos', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && shouldShowProgressStartToast(store.getters.getShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Videos'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0
  const useRss = store.getters.getUseRssFeeds

  try {
    const fetchChannel = async (channel, backend = store.getters.getBackendPreference) => {
      let videos, name, thumbnailUrl

      if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backend)) {
        if (useRss && hasInvidiousRssFeeds()) {
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

      if (name || thumbnailUrl) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl
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
 *  errorChannels?: any[]
 * }} options
 */
export function refreshSubscriptionShortsFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'shorts',
    activeProfile._id,
    () => refreshSubscriptionShortsFromRemoteUnlocked(options, activeProfile),
    options.t
  )
}

async function refreshSubscriptionShortsFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const activeSubscriptionList = getSubscriptionsForFeed(activeProfile.subscriptions, 'shorts')
  const subscriptionList = includeNotificationChannels(includeAutomaticDownloadChannels(activeSubscriptionList, 'shorts'), 'shorts')
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('shorts', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && shouldShowProgressStartToast(store.getters.getShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Shorts'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0

  try {
    await fetchSubscriptionsConcurrently(subscriptionList, async (channel, backend = store.getters.getBackendPreference) => {
      let videos, name

      if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backend)) {
        ({ videos, name } = hasInvidiousRssFeeds()
          ? await getChannelShortsInvidious(channel, t, errorChannels)
          : await getChannelShortsYattee(channel, t, errorChannels))
      } else {
        ({ videos, name } = await getChannelShortsLocal(channel, t, errorChannels))
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
 *  errorChannels?: any[]
 * }} options
 */
export function refreshSubscriptionLiveFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'live',
    activeProfile._id,
    () => refreshSubscriptionLiveFromRemoteUnlocked(options, activeProfile),
    options.t
  )
}

async function refreshSubscriptionLiveFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const activeSubscriptionList = getSubscriptionsForFeed(activeProfile.subscriptions, 'live')
  const subscriptionList = includeNotificationChannels(includeAutomaticDownloadChannels(activeSubscriptionList, 'live'), 'live')
  if (subscriptionList.length === 0) {
    completeSubscriptionRefresh('live', activeProfile._id)
    return []
  }

  store.commit('setSubscriptionFeedRefreshInProgress', true)
  setSubscriptionRefreshProgress(0)

  if (showStartToast && shouldShowProgressStartToast(store.getters.getShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Live Streams'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0
  const useRss = store.getters.getUseRssFeeds

  try {
    const fetchChannel = async (channel, backend = store.getters.getBackendPreference) => {
      let videos, name, thumbnailUrl

      if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backend)) {
        if (useRss && hasInvidiousRssFeeds()) {
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

      if (name || thumbnailUrl) {
        subscriptionUpdates.push({
          channelId: channel.id,
          channelName: name,
          channelThumbnailUrl: thumbnailUrl
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
 *  errorChannels?: any[]
 * }} options
 */
export function refreshSubscriptionPostsFromRemote(options) {
  const activeProfile = store.getters.getActiveProfile
  return withSubscriptionRefreshLock(
    'posts',
    activeProfile._id,
    () => refreshSubscriptionPostsFromRemoteUnlocked(options, activeProfile),
    options.t
  )
}

async function refreshSubscriptionPostsFromRemoteUnlocked({
  t,
  showStartToast = false,
  errorChannels = []
}, activeProfile) {
  const subscriptionList = includeNotificationChannels(getSubscriptionsForFeed(activeProfile.subscriptions, 'posts'), 'posts')
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

  if (showStartToast && shouldShowProgressStartToast(store.getters.getShowProgressBarToast)) {
    showToastOnAllTabs(t('Subscriptions.Refreshing Subscription Posts'), AUTO_REFRESH_TOAST_DURATION, ['fas', 'sync'])
  }

  const subscriptionUpdates = []
  let channelCount = 0

  try {
    const processChannel = async (channel, backend = store.getters.getBackendPreference) => {
      let posts

      if (backend === 'yattee') {
        // Yattee servers have no posts, so only the fallback can load them
        posts = await getChannelPostsLocal(channel, t, errorChannels)
      } else if (!process.env.SUPPORTS_LOCAL_API || backend === 'invidious') {
        posts = await getChannelPostsInvidious(channel, t, errorChannels)
      } else {
        posts = await getChannelPostsLocal(channel, t, errorChannels)
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
