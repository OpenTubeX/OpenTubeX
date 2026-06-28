<template>
  <SubscriptionsTabUi
    :is-loading="isLoading"
    :video-list="videoList"
    :error-channels="errorChannels"
    :last-refresh-timestamp="lastVideoRefreshTimestamp"
    :next-auto-refresh-timestamp="nextVideoAutoRefreshTimestamp"
    :next-auto-refresh-tooltip="nextVideoAutoRefreshTooltip"
    :attempted-fetch="attemptedFetch"
    :title="t('Global.Videos')"
    @refresh="loadVideosForSubscriptionsFromRemote"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from '../composables/use-i18n-polyfill'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import {
  copyToClipboard,
  getRelativeTimeFromDate,
  showToast,
  getChannelPlaylistId
} from '../helpers/utils'
import { getInvidiousChannelVideos, invidiousFetch } from '../helpers/api/invidious'
import { getLocalChannelVideos } from '../helpers/api/local'
import { parseYouTubeRSSFeed, updateVideoListAfterProcessing } from '../helpers/subscriptions'

const { locale, t } = useI18n()

const isLoading = ref(true)
const videoList = shallowRef([])
const errorChannels = ref([])
const attemptedFetch = ref(false)
/** @type {import('vue').Ref<number | null>} */
const lastRemoteRefreshSuccessTimestamp = ref(null)
const now = ref(Date.now())

let alreadyLoadedRemotely = false
let nextAutoRefreshTicker = null

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)

/** @type {import('vue').ComputedRef<boolean>} */
const useRssFeeds = computed(() => store.getters.getUseRssFeeds)

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const activeSubscriptionList = computed(() => store.getters.getActiveProfile.subscriptions)

const cacheEntriesForAllActiveProfileChannels = computed(() => {
  const videoCache = store.getters.getVideoCache
  const entries = []

  activeSubscriptionList.value.forEach((channel) => {
    const cacheEntry = videoCache[channel.id]

    if (cacheEntry != null) {
      entries.push(cacheEntry)
    }
  })

  return entries
})

const videoCacheForAllActiveProfileChannelsPresent = computed(() => {
  if (
    cacheEntriesForAllActiveProfileChannels.value.length === 0 ||
    cacheEntriesForAllActiveProfileChannels.value.length < activeSubscriptionList.value.length
  ) {
    return false
  }

  return cacheEntriesForAllActiveProfileChannels.value.every((cacheEntry) => {
    return cacheEntry.videos != null
  })
})

const lastVideoRefreshTimestamp = computed(() => {
  // Cache is not ready when data is just loaded from remote
  if (lastRemoteRefreshSuccessTimestamp.value) {
    return getRelativeTimeFromDate(lastRemoteRefreshSuccessTimestamp.value, true)
  }

  if (
    !videoCacheForAllActiveProfileChannelsPresent.value ||
     cacheEntriesForAllActiveProfileChannels.value.length === 0
  ) {
    return ''
  }

  let minTimestamp = null
  cacheEntriesForAllActiveProfileChannels.value.forEach((cacheEntry) => {
    if (!minTimestamp || cacheEntry.timestamp.getTime() < minTimestamp.getTime()) {
      minTimestamp = cacheEntry.timestamp
    }
  })
  return getRelativeTimeFromDate(minTimestamp.getTime(), true)
})

const nextVideoAutoRefreshTimestamp = computed(() => {
  const timestamp = store.getters.getSubscriptionFeedNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionFeedAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  return new Intl.DateTimeFormat([locale.value, 'en'], {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(timestamp)
})

const nextVideoAutoRefreshTooltip = computed(() => {
  const timestamp = store.getters.getSubscriptionFeedNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionFeedAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  return new Intl.RelativeTimeFormat([locale.value, 'en'], { numeric: 'auto' }).format(
    getRelativeTimeValue(timestamp - now.value).value,
    getRelativeTimeValue(timestamp - now.value).unit
  )
})

/**
 * @param {number} remainingMs
 */
function getRelativeTimeValue(remainingMs) {
  const absRemainingSeconds = Math.max(Math.ceil(Math.abs(remainingMs) / 1000), 0)

  if (absRemainingSeconds < 60) {
    return { value: Math.ceil(remainingMs / 1000), unit: 'second' }
  }

  const remainingMinutes = remainingMs / 60000
  if (Math.abs(remainingMinutes) < 60) {
    return { value: Math.ceil(remainingMinutes), unit: 'minute' }
  }

  const remainingHours = remainingMs / 3600000
  return { value: Math.ceil(remainingHours), unit: 'hour' }
}

watch(activeSubscriptionList, () => {
  lastRemoteRefreshSuccessTimestamp.value = null
  isLoading.value = true
  loadVideosFromCacheSometimes()
}, { deep: true })

watch(
  () => store.getters.getSubscriptionFeedLastRefreshTimestamp,
  () => {
    if (subscriptionCacheReady.value) {
      loadVideosFromCacheForAllActiveProfileChannels()
    }
  }
)

if (!subscriptionCacheReady.value) {
  watch(subscriptionCacheReady, () => {
    if (!alreadyLoadedRemotely) {
      loadVideosFromCacheSometimes()
    }
  })
}

onMounted(() => {
  nextAutoRefreshTicker = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadVideosFromRemoteFirstPerWindowSometimes()
})

onBeforeUnmount(() => {
  clearInterval(nextAutoRefreshTicker)
})

function loadVideosFromRemoteFirstPerWindowSometimes() {
  if (
    !fetchSubscriptionsAutomatically.value ||
    // Only auto fetch once per window
    store.getters.getSubscriptionForVideosFirstAutoFetchRun
  ) {
    loadVideosFromCacheSometimes()
    return
  }

  alreadyLoadedRemotely = true
  loadVideosForSubscriptionsFromRemote()
  store.commit('setSubscriptionForVideosFirstAutoFetchRun')
}

function loadVideosFromCacheSometimes() {
  // Can only load reliably when cache ready
  if (!subscriptionCacheReady.value) { return }

  // This method is called on view visible
  if (videoCacheForAllActiveProfileChannelsPresent.value) {
    loadVideosFromCacheForAllActiveProfileChannels()
    return
  }

  if (fetchSubscriptionsAutomatically.value) {
    // `isLoading.value = false` is called inside `loadVideosForSubscriptionsFromRemote` when needed
    loadVideosForSubscriptionsFromRemote()
    return
  }

  // Auto fetch disabled, not enough cache for profile = show nothing
  videoList.value = []
  attemptedFetch.value = false
  isLoading.value = false
}

function loadVideosFromCacheForAllActiveProfileChannels() {
  const videoList_ = cacheEntriesForAllActiveProfileChannels.value.flatMap((cacheEntry) => {
    return cacheEntry.videos
  })

  videoList.value = updateVideoListAfterProcessing(videoList_)
  isLoading.value = false
}

async function loadVideosForSubscriptionsFromRemote() {
  if (store.getters.getSubscriptionFeedRefreshInProgress) {
    return
  }

  if (activeSubscriptionList.value.length === 0) {
    isLoading.value = false
    videoList.value = []
    store.commit('setSubscriptionFeedLastRefreshTimestamp', Date.now())
    return
  }

  const channelsToLoadFromRemote = activeSubscriptionList.value
  let channelCount = 0
  isLoading.value = true
  store.commit('setSubscriptionFeedRefreshInProgress', true)

  let useRss = useRssFeeds.value
  if (channelsToLoadFromRemote.length >= 125 && !useRss) {
    showToast(
      t('Subscriptions["This profile has a large number of subscriptions. Forcing RSS to avoid rate limiting"]'),
      10000
    )
    useRss = true
  }

  store.commit('setShowProgressBar', true)
  store.commit('setProgressBarPercentage', 0)
  attemptedFetch.value = true

  try {
    errorChannels.value = []
    const subscriptionUpdates = []

    const videoListFromRemote = (await Promise.all(channelsToLoadFromRemote.map(async (channel) => {
      let videos, name, thumbnailUrl

      if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
        if (useRss) {
          ({ videos, name, thumbnailUrl } = await getChannelVideosInvidiousRSS(channel))
        } else {
          ({ videos, name, thumbnailUrl } = await getChannelVideosInvidiousScraper(channel))
        }
      } else {
        if (useRss) {
          ({ videos, name, thumbnailUrl } = await getChannelVideosLocalRSS(channel))
        } else {
          ({ videos, name, thumbnailUrl } = await getChannelVideosLocalScraper(channel))
        }
      }

      channelCount++
      const percentageComplete = (channelCount / channelsToLoadFromRemote.length) * 100
      store.commit('setProgressBarPercentage', percentageComplete)

      if (videos != null) {
        store.dispatch('updateSubscriptionVideosCacheByChannel', {
          channelId: channel.id,
          videos: videos
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
    }))).flat()

    videoList.value = updateVideoListAfterProcessing(videoListFromRemote)
    lastRemoteRefreshSuccessTimestamp.value = Date.now()
    store.commit('setSubscriptionFeedLastRefreshTimestamp', lastRemoteRefreshSuccessTimestamp.value)

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)
  } finally {
    isLoading.value = false
    store.commit('setShowProgressBar', false)
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

async function getChannelVideosLocalScraper(channel, failedAttempts = 0) {
  try {
    const result = await getLocalChannelVideos(channel.id)

    if (result === null) {
      errorChannels.value.push(channel)
      return {
        videos: null
      }
    }

    return result
  } catch (err) {
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showToast(`${errorMessage}: ${err}`, 10000, () => {
      copyToClipboard(err)
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalRSS(channel, failedAttempts + 1)
      case 1:
        if (backendFallback.value) {
          showToast(t('Falling back to Invidious API'))
          return await getChannelVideosInvidiousScraper(channel, failedAttempts + 1)
        } else {
          return {
            videos: null
          }
        }
      case 2:
        return await getChannelVideosLocalRSS(channel, failedAttempts + 1)
      default:
        return {
          videos: null
        }
    }
  }
}

async function getChannelVideosLocalRSS(channel, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await fetch(feedUrl)

    if (response.status === 403) {
      return {
        videos: null
      }
    }

    if (response.status === 404) {
      // playlists don't exist if the channel was terminated but also if it doesn't have the tab,
      // so we need to check the channel feed too before deciding it errored, as that only 404s if the channel was terminated

      const response2 = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, {
        method: 'HEAD'
      })

      if (response2.status === 404) {
        errorChannels.value.push(channel)
        return {
          videos: null
        }
      }

      return {
        videos: []
      }
    }

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    console.error(error)
    const errorMessage = t('Local API Error (Click to copy)')
    showToast(`${errorMessage}: ${error}`, 10000, () => {
      copyToClipboard(error)
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalScraper(channel, failedAttempts + 1)
      case 1:
        if (backendFallback.value) {
          showToast(t('Falling back to Invidious API'))
          return await getChannelVideosInvidiousRSS(channel, failedAttempts + 1)
        } else {
          return {
            videos: null
          }
        }
      case 2:
        return await getChannelVideosLocalScraper(channel, failedAttempts + 1)
      default:
        return {
          videos: null
        }
    }
  }
}

async function getChannelVideosInvidiousScraper(channel, failedAttempts = 0) {
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
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showToast(`${errorMessage}: ${err}`, 10000, () => {
      copyToClipboard(err)
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousRSS(channel, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && backendFallback.value) {
          showToast(t('Falling back to Local API'))
          return await getChannelVideosLocalScraper(channel, failedAttempts + 1)
        } else {
          return {
            videos: null
          }
        }
      case 2:
        return await getChannelVideosInvidiousRSS(channel, failedAttempts + 1)
      default:
        return {
          videos: null
        }
    }
  }
}

async function getChannelVideosInvidiousRSS(channel, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `${currentInvidiousInstanceUrl.value}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl)

    if (response.status === 404) {
      // playlists don't exist if the channel was terminated but also if it doesn't have the tab,
      // so we need to check the channel feed too before deciding it errored, as that only 404s if the channel was terminated

      const response2 = await fetch(`${currentInvidiousInstanceUrl.value}/feed/channel/${channel.id}`, {
        method: 'GET'
      })

      if (response2.status === 404) {
        errorChannels.value.push(channel)
        return {
          videos: null
        }
      }

      return {
        videos: []
      }
    }

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    console.error(error)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showToast(`${errorMessage}: ${error}`, 10000, () => {
      copyToClipboard(error)
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousScraper(channel, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && backendFallback.value) {
          showToast(t('Falling back to Local API'))
          return await getChannelVideosLocalRSS(channel, failedAttempts + 1)
        } else {
          return {
            videos: null
          }
        }
      case 2:
        return await getChannelVideosInvidiousScraper(channel, failedAttempts + 1)
      default:
        return {
          videos: null
        }
    }
  }
}
</script>
