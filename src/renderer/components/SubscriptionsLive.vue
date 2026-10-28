<template>
  <SubscriptionsTabUi
    ref="tabUi"
    :is-loading="isLoading"
    :video-list="videoList"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    refresh-tab="live"
    @refresh="loadVideosForSubscriptionsFromRemote"
  />
</template>

<script setup>
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useKeepAliveEffectScope } from '../composables/useKeepAliveEffectScope'
import { useRelativeTimeClock } from '../composables/useRelativeTimeClock'
import { useSubscriptionChannelUpdates } from '../composables/useSubscriptionChannelUpdates'
import { getUpcomingPremiereTimestamp } from '../helpers/subscription-entries'
import { getCachedRelativeTimeFormat, getRelativeTimeFromDate } from '../helpers/utils'
import { formatShortDateTime } from '../helpers/dateFormat'
import {
  refreshSubscriptionLiveFromRemote,
  updateVideoListAfterProcessing
} from '../helpers/subscriptions'
import { getSubscriptionsForFeed } from '../helpers/subscription-channels'

const { locale, t } = useI18n()
const tabUi = useTemplateRef('tabUi')
useKeepAliveEffectScope()

const isLoading = ref(true)
const videoList = shallowRef([])
const errorChannels = ref([])
const attemptedFetch = ref(false)
/** @type {import('vue').Ref<number | null>} */
const lastRemoteRefreshSuccessTimestamp = ref(null)
const dateFormat = computed(() => store.getters.getDateFormat)
const timeFormat = computed(() => store.getters.getTimeFormat)

let alreadyLoadedRemotely = false

const MAX_TIMEOUT_MS = 2 ** 31 - 1
/** @type {number | null} */
let nextScheduledStartTimestamp = null
/** @type {ReturnType<typeof setTimeout> | null} */
let scheduledStartTimer = null
let isActive = true

const now = useRelativeTimeClock()

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const activeSubscriptionList = computed(() => (
  getSubscriptionsForFeed(store.getters.getActiveGroupSubscriptions, 'live')
))

const cacheEntriesForAllActiveProfileChannels = computed(() => {
  const liveCache = store.getters.getLiveCache
  const entries = []

  activeSubscriptionList.value.forEach((channel) => {
    const cacheEntry = liveCache[channel.id]

    if (cacheEntry != null) {
      entries.push(cacheEntry)
    }
  })

  return entries
})

const videoCacheForAllActiveProfileChannelsPresent = computed(() => {
  // A group can leave no channels for this feed, which has nothing to fetch
  if (activeSubscriptionList.value.length === 0) {
    return true
  }

  if (cacheEntriesForAllActiveProfileChannels.value.length < activeSubscriptionList.value.length) {
    return false
  }

  return cacheEntriesForAllActiveProfileChannels.value.every((cacheEntry) => {
    return cacheEntry.videos != null
  })
})

const lastLiveRefreshTimestamp = computed(() => {
  // Cache is not ready when data is just loaded from remote
  if (lastRemoteRefreshSuccessTimestamp.value) {
    return getRelativeTimeFromDate(lastRemoteRefreshSuccessTimestamp.value, true, true, now.value)
  }

  if (
    !videoCacheForAllActiveProfileChannelsPresent.value ||
    cacheEntriesForAllActiveProfileChannels.value.length === 0
  ) {
    return ''
  }

  // Closed-app refreshes skip unchanged channels, so their cache entries keep
  // the previous fetch time while the completed refresh is newer.
  let latestTimestamp = store.getters.getSubscriptionLiveLastRefreshTimestamp ?? 0
  cacheEntriesForAllActiveProfileChannels.value.forEach((cacheEntry) => {
    const timestamp = cacheEntry.timestamp.getTime()
    // An invalid persisted date compares false instead of hiding valid ones.
    if (timestamp > latestTimestamp) latestTimestamp = timestamp
  })
  if (latestTimestamp === 0) return ''

  return getRelativeTimeFromDate(latestTimestamp, true, true, now.value)
})

const refreshTitle = computed(() => {
  return t('Global.Live')
})

const hasNewContent = computed(() => tabUi.value?.hasNewContent === true)

const nextAutoRefreshTimestamp = computed(() => {
  const timestamp = store.getters.getSubscriptionLiveNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionLiveAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  return formatShortDateTime(timestamp, locale.value, dateFormat.value, timeFormat.value)
})

const nextAutoRefreshTooltip = computed(() => {
  const timestamp = store.getters.getSubscriptionLiveNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionLiveAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  const relativeTime = getRelativeTimeValue(timestamp - now.value)

  return getCachedRelativeTimeFormat(locale.value, 'auto').format(relativeTime.value, relativeTime.unit)
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

// Watching the channel ids instead of deep watching the subscription list,
// avoids traversing every channel object on unrelated changes
// and firing on channel name/thumbnail updates
watch(() => activeSubscriptionList.value.map((channel) => channel.id).join(','), () => {
  lastRemoteRefreshSuccessTimestamp.value = null
  isLoading.value = true
  loadVideosFromCacheSometimes()
})

watch(
  [
    () => store.getters.getSubscriptionLiveLastRefreshTimestamp,
    () => store.getters.getSubscriptionSeenVideos
  ],
  () => {
    if (subscriptionCacheReady.value) {
      loadVideosFromCacheForAllActiveProfileChannels()
    }
  }
)

watch(() => store.getters.getShowScheduledLiveStreamsFirst, () => {
  if (subscriptionCacheReady.value) {
    loadVideosFromCacheForAllActiveProfileChannels()
  }
})

// Started streams move from their announcement position and show as live.
function scheduleScheduledStartUpdate() {
  clearScheduledStartTimer()
  // A refresh can finish after this tab was hidden or closed.
  if (!isActive || nextScheduledStartTimestamp === null) return

  scheduledStartTimer = setTimeout(() => {
    scheduledStartTimer = null
    loadVideosFromCacheForAllActiveProfileChannels()
  }, Math.min(Math.max(nextScheduledStartTimestamp - Date.now(), 0), MAX_TIMEOUT_MS))
}

function clearScheduledStartTimer() {
  if (scheduledStartTimer !== null) {
    clearTimeout(scheduledStartTimer)
    scheduledStartTimer = null
  }
}

function stopScheduledStartUpdates() {
  isActive = false
  clearScheduledStartTimer()
}

onActivated(() => {
  isActive = true
  scheduleScheduledStartUpdate()
})
onDeactivated(stopScheduledStartUpdates)
onBeforeUnmount(stopScheduledStartUpdates)

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
    store.getters.getSubscriptionForLiveStreamsFirstAutoFetchRun
  ) {
    loadVideosFromCacheSometimes()
    return
  }

  alreadyLoadedRemotely = true
  loadVideosForSubscriptionsFromRemote()
  store.commit('setSubscriptionForLiveStreamsFirstAutoFetchRun')
}

function loadVideosFromCacheSometimes() {
  // Can only load reliably when cache ready
  if (!subscriptionCacheReady.value) { return }

  // This method is called on view visible
  if (videoCacheForAllActiveProfileChannelsPresent.value) {
    attemptedFetch.value = true
    loadVideosFromCacheForAllActiveProfileChannels()
    return
  }

  if (fetchSubscriptionsAutomatically.value) {
    // `isLoading.value = false` is called inside `loadVideosForSubscriptionsFromRemote` when needed
    loadVideosForSubscriptionsFromRemote()
    return
  }

  // Auto fetch disabled, show the cache that is available for the profile
  attemptedFetch.value = false
  loadVideosFromCacheForAllActiveProfileChannels()
}

function loadVideosFromCacheForAllActiveProfileChannels() {
  const videoList_ = cacheEntriesForAllActiveProfileChannels.value.flatMap((cacheEntry) => {
    return cacheEntry.videos ?? []
  })

  const currentTime = Date.now()
  nextScheduledStartTimestamp = null
  for (const video of videoList_) {
    const timestamp = getUpcomingPremiereTimestamp(video)
    if (timestamp > currentTime && (nextScheduledStartTimestamp === null || timestamp < nextScheduledStartTimestamp)) {
      nextScheduledStartTimestamp = timestamp
    }
  }

  videoList.value = updateVideoListAfterProcessing(videoList_, currentTime)
  isLoading.value = false
  scheduleScheduledStartUpdate()
}

// Show the channels that have been fetched so far, instead of waiting for the
// whole refresh to finish
useSubscriptionChannelUpdates('live', () => {
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
    const refreshedVideos = await refreshSubscriptionLiveFromRemote({
      t,
      errorChannels: errorChannels.value
    })
    if (refreshedVideos !== null) {
      loadVideosFromCacheForAllActiveProfileChannels()
      lastRemoteRefreshSuccessTimestamp.value = store.getters.getSubscriptionLiveLastRefreshTimestamp
    }
  } finally {
    isLoading.value = false
  }
}

defineExpose({
  refresh: loadVideosForSubscriptionsFromRemote,
  isLoading,
  lastRefreshTimestamp: lastLiveRefreshTimestamp,
  nextAutoRefreshTimestamp,
  nextAutoRefreshTooltip,
  refreshTitle,
  hasNewContent
})
</script>
