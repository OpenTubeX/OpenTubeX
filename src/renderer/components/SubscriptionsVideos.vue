<template>
  <SubscriptionsTabUi
    ref="tabUi"
    :is-loading="isLoading"
    :video-list="videoList"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    :only-show-new="onlyShowNew"
    @refresh="loadVideosForSubscriptionsFromRemote"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { getRelativeTimeFromDate } from '../helpers/utils'
import {
  refreshSubscriptionVideosFromRemote,
  updateVideoListAfterProcessing
} from '../helpers/subscriptions'

const { locale, t } = useI18n()
const tabUi = useTemplateRef('tabUi')

defineProps({
  onlyShowNew: {
    type: Boolean,
    default: false
  }
})

const isLoading = ref(true)
const videoList = shallowRef([])
const errorChannels = ref([])
const attemptedFetch = ref(false)
/** @type {import('vue').Ref<number | null>} */
const lastRemoteRefreshSuccessTimestamp = ref(null)
const now = ref(Date.now())

let alreadyLoadedRemotely = false
let nextAutoRefreshTicker = null

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

const refreshTitle = computed(() => {
  return t('Global.Videos')
})

const hasVisibleNewContent = computed(() => tabUi.value?.hasVisibleNewContent === true)

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

  isLoading.value = true
  attemptedFetch.value = true
  errorChannels.value = []

  try {
    const refreshedVideos = await refreshSubscriptionVideosFromRemote({
      t,
      errorChannels: errorChannels.value
    })
    if (refreshedVideos !== null) {
      videoList.value = refreshedVideos
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
  hasVisibleNewContent
})
</script>
