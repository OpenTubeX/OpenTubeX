<template>
  <SubscriptionsTabUi
    ref="tabUi"
    :is-loading="isLoading"
    :video-list="videoList"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    refresh-tab="videos"
    @refresh="loadVideosForSubscriptionsFromRemote"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useAutoRefreshClock } from '../composables/useAutoRefreshClock'
import { useSubscriptionChannelUpdates } from '../composables/useSubscriptionChannelUpdates'
import { getUpcomingPremiereTimestamp } from '../helpers/subscription-entries'
import { getCachedRelativeTimeFormat, getCachedShortDateTimeFormat, getRelativeTimeFromDate } from '../helpers/utils'
import {
  refreshSubscriptionVideosFromRemote,
  updateVideoListAfterProcessing
} from '../helpers/subscriptions'

const { locale, t } = useI18n()
const tabUi = useTemplateRef('tabUi')

const isLoading = ref(true)
const videoList = shallowRef([])
const errorChannels = ref([])
const attemptedFetch = ref(false)
/** @type {import('vue').Ref<number | null>} */
const lastRemoteRefreshSuccessTimestamp = ref(null)
/** @type {import('vue').ComputedRef<boolean>} */
const hasPendingAutoRefresh = computed(() => {
  const interval = parseInt(store.getters.getSubscriptionFeedAutoRefreshInterval, 10)

  return !!store.getters.getSubscriptionFeedNextAutoRefreshTimestamp &&
    !Number.isNaN(interval) && interval > 0
})

const now = useAutoRefreshClock(hasPendingAutoRefresh)
const premiereUpdateNow = ref(Date.now())
const MAX_TIMEOUT_MS = 2 ** 31 - 1
/** @type {ReturnType<typeof setTimeout> | null} */
let premiereUpdateTimer = null

let alreadyLoadedRemotely = false

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)

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

const nextUpcomingPremiereTimestamp = computed(() => {
  let nextTimestamp = null

  for (const cacheEntry of cacheEntriesForAllActiveProfileChannels.value) {
    for (const video of cacheEntry.videos ?? []) {
      const timestamp = getUpcomingPremiereTimestamp(video)

      if (
        timestamp != null &&
        timestamp > premiereUpdateNow.value &&
        (nextTimestamp == null || timestamp < nextTimestamp)
      ) {
        nextTimestamp = timestamp
      }
    }
  }

  return nextTimestamp
})

watch(nextUpcomingPremiereTimestamp, scheduleNextPremiereUpdate, { immediate: true })

function scheduleNextPremiereUpdate(timestamp) {
  if (premiereUpdateTimer !== null) {
    clearTimeout(premiereUpdateTimer)
    premiereUpdateTimer = null
  }

  if (timestamp == null) {
    return
  }

  premiereUpdateTimer = setTimeout(() => {
    premiereUpdateTimer = null
    premiereUpdateNow.value = Date.now()
    loadVideosFromCacheForAllActiveProfileChannels()
    scheduleNextPremiereUpdate(nextUpcomingPremiereTimestamp.value)
  }, Math.min(Math.max(timestamp - Date.now(), 0), MAX_TIMEOUT_MS))
}

onBeforeUnmount(() => {
  if (premiereUpdateTimer !== null) {
    clearTimeout(premiereUpdateTimer)
  }
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

  return getCachedShortDateTimeFormat(locale.value).format(timestamp)
})

const nextVideoAutoRefreshTooltip = computed(() => {
  const timestamp = store.getters.getSubscriptionFeedNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionFeedAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  const relativeTime = getRelativeTimeValue(timestamp - now.value)

  return getCachedRelativeTimeFormat(locale.value, 'auto').format(relativeTime.value, relativeTime.unit)
})

const refreshTitle = computed(() => {
  return t('Global.Videos')
})

const hasNewContent = computed(() => tabUi.value?.hasNewContent === true)

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

// Watching the channel ids instead of deep watching the subscription list,
// avoids traversing every channel object on unrelated changes
// and firing on channel name/thumbnail updates
watch(() => activeSubscriptionList.value.map((channel) => channel.id).join(','), () => {
  lastRemoteRefreshSuccessTimestamp.value = null
  isLoading.value = true
  loadVideosFromCacheSometimes()
})

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
  loadVideosFromRemoteFirstPerWindowSometimes()
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
    return cacheEntry.videos ?? []
  })

  videoList.value = updateVideoListAfterProcessing(videoList_, premiereUpdateNow.value)
  isLoading.value = false
}

// Show the channels that have been fetched so far, instead of waiting for the
// whole refresh to finish
useSubscriptionChannelUpdates('videos', () => {
  if (subscriptionCacheReady.value) {
    loadVideosFromCacheForAllActiveProfileChannels()
  }
})

async function loadVideosForSubscriptionsFromRemote() {
  isLoading.value = true
  attemptedFetch.value = true
  errorChannels.value = []

  // Whatever is cached is shown right away, the refresh then replaces it
  // channel by channel
  if (subscriptionCacheReady.value && cacheEntriesForAllActiveProfileChannels.value.length > 0) {
    loadVideosFromCacheForAllActiveProfileChannels()
  }

  try {
    const refreshedVideos = await refreshSubscriptionVideosFromRemote({
      t,
      errorChannels: errorChannels.value
    })
    if (refreshedVideos !== null) {
      loadVideosFromCacheForAllActiveProfileChannels()
      lastRemoteRefreshSuccessTimestamp.value = store.getters.getSubscriptionFeedLastRefreshTimestamp
    }
  } finally {
    isLoading.value = false
  }
}

defineExpose({
  refresh: loadVideosForSubscriptionsFromRemote,
  isLoading,
  lastRefreshTimestamp: lastVideoRefreshTimestamp,
  nextAutoRefreshTimestamp: nextVideoAutoRefreshTimestamp,
  nextAutoRefreshTooltip: nextVideoAutoRefreshTooltip,
  refreshTitle,
  hasNewContent
})
</script>
