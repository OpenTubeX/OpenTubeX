<template>
  <SubscriptionsTabUi
    :is-loading="isLoading"
    :video-list="videoList"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    @refresh="loadVideosForSubscriptionsFromRemote"
  />
</template>

<script setup>
import { computed, shallowRef, ref, watch, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import {
  parseYouTubeRSSFeed,
  showSubscriptionFetchError,
  updateVideoListAfterProcessing
} from '../helpers/subscriptions'
import {
  getChannelPlaylistId,
  getRelativeTimeFromDate,
  showToast
} from '../helpers/utils'
import { invidiousFetch } from '../helpers/api/invidious'

const { locale, t } = useI18n()

const isLoading = ref(true)
const videoList = shallowRef([])
const errorChannels = ref([])
const attemptedFetch = ref(false)
/** @type {import('vue').Ref<number | null>} */
const lastRemoteRefreshSuccessTimestamp = ref(null)

let alreadyLoadedRemotely = false
let nextAutoRefreshTicker = null
const now = ref(Date.now())

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const activeSubscriptionList = computed(() => store.getters.getActiveProfile.subscriptions)

const cacheEntriesForAllActiveProfileChannels = computed(() => {
  const shortsCache = store.getters.getShortsCache
  const entries = []

  activeSubscriptionList.value.forEach((channel) => {
    const cacheEntry = shortsCache[channel.id]

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

const lastShortRefreshTimestamp = computed(() => {
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

const refreshTitle = computed(() => {
  return t('Global.Shorts')
})

const nextAutoRefreshTimestamp = computed(() => {
  const timestamp = store.getters.getSubscriptionShortsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionShortsAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  return new Intl.DateTimeFormat([locale.value, 'en'], {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(timestamp)
})

const nextAutoRefreshTooltip = computed(() => {
  const timestamp = store.getters.getSubscriptionShortsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionShortsAutoRefreshInterval, 10)

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
  const direction = remainingMs < 0 ? -1 : 1
  const absRemainingSeconds = Math.max(Math.round(Math.abs(remainingMs) / 1000), 0)

  if (absRemainingSeconds < 60) {
    return { value: direction * absRemainingSeconds, unit: 'second' }
  }

  const absRemainingMinutes = Math.round(absRemainingSeconds / 60)
  if (absRemainingMinutes < 60) {
    return { value: direction * absRemainingMinutes, unit: 'minute' }
  }

  return { value: direction * Math.round(absRemainingMinutes / 60), unit: 'hour' }
}

watch(activeSubscriptionList, () => {
  lastRemoteRefreshSuccessTimestamp.value = null
  isLoading.value = true
  loadVideosFromCacheSometimes()
}, { deep: true })

watch(
  () => store.getters.getSubscriptionShortsLastRefreshTimestamp,
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
    store.getters.getSubscriptionForShortsFirstAutoFetchRun
  ) {
    loadVideosFromCacheSometimes()
    return
  }

  alreadyLoadedRemotely = true
  loadVideosForSubscriptionsFromRemote()
  store.commit('setSubscriptionForShortsFirstAutoFetchRun')
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
    store.commit('setSubscriptionShortsLastRefreshTimestamp', Date.now())
    return
  }

  const channelsToLoadFromRemote = activeSubscriptionList.value
  let channelCount = 0
  isLoading.value = true
  store.commit('setSubscriptionFeedRefreshInProgress', true)
  store.commit('setShowProgressBar', true)
  store.commit('setProgressBarPercentage', 0)
  attemptedFetch.value = true

  try {
    errorChannels.value = []
    const subscriptionUpdates = []

    const videoListFromRemote = (await Promise.all(channelsToLoadFromRemote.map(async (channel) => {
      let videos, name

      if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
        ({ videos, name } = await getChannelShortsInvidious(channel))
      } else {
        ({ videos, name } = await getChannelShortsLocal(channel))
      }

      channelCount++
      const percentageComplete = (channelCount / channelsToLoadFromRemote.length) * 100
      store.commit('setProgressBarPercentage', percentageComplete)

      if (videos != null) {
        store.dispatch('updateSubscriptionShortsCacheByChannel', {
          channelId: channel.id,
          videos: videos
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

    videoList.value = updateVideoListAfterProcessing(videoListFromRemote)
    lastRemoteRefreshSuccessTimestamp.value = Date.now()
    store.commit('setSubscriptionShortsLastRefreshTimestamp', lastRemoteRefreshSuccessTimestamp.value)

    store.dispatch('batchUpdateSubscriptionDetails', subscriptionUpdates)
  } finally {
    isLoading.value = false
    store.commit('setShowProgressBar', false)
    store.commit('setSubscriptionFeedRefreshInProgress', false)
  }
}

async function getChannelShortsLocal(channel, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
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
    showSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        if (backendFallback.value) {
          showToast(t('Falling back to Invidious API'))
          return await getChannelShortsInvidious(channel, failedAttempts + 1)
        } else {
          return {
            videos: null
          }
        }
      default:
        return {
          videos: null
        }
    }
  }
}

async function getChannelShortsInvidious(channel, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
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
        return { videos: null }
      }

      return { videos: [] }
    }

    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    showSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'))

    switch (failedAttempts) {
      case 0:
        if (process.env.SUPPORTS_LOCAL_API && backendFallback.value) {
          showToast(t('Falling back to Local API'))
          return await getChannelShortsLocal(channel, failedAttempts + 1)
        } else {
          return {
            videos: null
          }
        }
      default:
        return {
          videos: null
        }
    }
  }
}

defineExpose({
  refresh: loadVideosForSubscriptionsFromRemote,
  isLoading,
  lastRefreshTimestamp: lastShortRefreshTimestamp,
  nextAutoRefreshTimestamp,
  nextAutoRefreshTooltip,
  refreshTitle
})
</script>
