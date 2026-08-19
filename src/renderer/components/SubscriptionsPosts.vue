<template>
  <SubscriptionsTabUi
    ref="tabUi"
    :is-loading="isLoading"
    :video-list="postList"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    refresh-tab="posts"
    :is-community="true"
    :initial-data-limit="20"
    @refresh="loadPostsForSubscriptionsFromRemote"
  />
</template>

<script setup>
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useKeepAliveEffectScope } from '../composables/useKeepAliveEffectScope'
import { useRelativeTimeClock } from '../composables/useRelativeTimeClock'
import { useSubscriptionChannelUpdates } from '../composables/useSubscriptionChannelUpdates'
import { getCachedRelativeTimeFormat, getCachedShortDateTimeFormat, getRelativeTimeFromDate } from '../helpers/utils'
import { refreshSubscriptionPostsFromRemote } from '../helpers/subscriptions'

const { locale, t } = useI18n()
const tabUi = useTemplateRef('tabUi')
useKeepAliveEffectScope()

const isLoading = ref(true)
const postList = shallowRef([])
const errorChannels = ref([])
const attemptedFetch = ref(false)
/** @type {import('vue').Ref<number | null>} */
const lastRemoteRefreshSuccessTimestamp = ref(null)

const now = useRelativeTimeClock()

let alreadyLoadedRemotely = false

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const activeSubscriptionList = computed(() => store.getters.getActiveProfile.subscriptions)

const cacheEntriesForAllActiveProfileChannels = computed(() => {
  const postsCache = store.getters.getPostsCache
  const entries = []

  activeSubscriptionList.value.forEach((channel) => {
    const cacheEntry = postsCache[channel.id]

    if (cacheEntry != null) {
      entries.push(cacheEntry)
    }
  })

  return entries
})

const postCacheForAllActiveProfileChannelsPresent = computed(() => {
  if (
    cacheEntriesForAllActiveProfileChannels.value.length === 0 ||
    cacheEntriesForAllActiveProfileChannels.value.length < activeSubscriptionList.value.length
  ) {
    return false
  }

  return cacheEntriesForAllActiveProfileChannels.value.every((cacheEntry) => {
    return cacheEntry.posts != null
  })
})

const lastPostsRefreshTimestamp = computed(() => {
  // Cache is not ready when data is just loaded from remote
  if (lastRemoteRefreshSuccessTimestamp.value) {
    return getRelativeTimeFromDate(lastRemoteRefreshSuccessTimestamp.value, true, true, now.value)
  }

  if (
    !postCacheForAllActiveProfileChannelsPresent.value ||
    cacheEntriesForAllActiveProfileChannels.value.length === 0
  ) {
    return ''
  }

  let latestTimestamp = null
  cacheEntriesForAllActiveProfileChannels.value.forEach((cacheEntry) => {
    if (!latestTimestamp || cacheEntry.timestamp.getTime() > latestTimestamp.getTime()) {
      latestTimestamp = cacheEntry.timestamp
    }
  })

  return getRelativeTimeFromDate(latestTimestamp.getTime(), true, true, now.value)
})

const refreshTitle = computed(() => {
  return t('Global.Posts')
})

const hasNewContent = computed(() => tabUi.value?.hasNewContent === true)

const nextAutoRefreshTimestamp = computed(() => {
  const timestamp = store.getters.getSubscriptionPostsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionPostsAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  return getCachedShortDateTimeFormat(locale.value).format(timestamp)
})

const nextAutoRefreshTooltip = computed(() => {
  const timestamp = store.getters.getSubscriptionPostsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionPostsAutoRefreshInterval, 10)

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
  loadPostsFromCacheSometimes()
})

watch(
  () => store.getters.getSubscriptionPostsLastRefreshTimestamp,
  () => {
    if (subscriptionCacheReady.value) {
      loadPostsFromCacheForAllActiveProfileChannels()
    }
  }
)

if (!subscriptionCacheReady.value) {
  watch(subscriptionCacheReady, () => {
    if (!alreadyLoadedRemotely) {
      loadPostsFromCacheSometimes()
    }
  })
}

onMounted(() => {
  loadPostsFromRemoteFirstPerWindowSometimes()
})

function loadPostsFromRemoteFirstPerWindowSometimes() {
  if (
    !fetchSubscriptionsAutomatically.value ||
    // Only auto fetch once per window
    store.getters.getSubscriptionForPostsFirstAutoFetchRun
  ) {
    loadPostsFromCacheSometimes()
    return
  }

  alreadyLoadedRemotely = true
  loadPostsForSubscriptionsFromRemote()
  store.commit('setSubscriptionForPostsFirstAutoFetchRun')
}

function loadPostsFromCacheSometimes() {
  // Can only load reliably when cache ready
  if (!subscriptionCacheReady.value) { return }

  // This method is called on view visible
  if (postCacheForAllActiveProfileChannelsPresent.value) {
    attemptedFetch.value = true
    loadPostsFromCacheForAllActiveProfileChannels()
    return
  }

  if (fetchSubscriptionsAutomatically.value) {
    // `isLoading.value = false` is called inside `loadPostsForSubscriptionsFromRemote` when needed
    loadPostsForSubscriptionsFromRemote()
    return
  }

  // Auto fetch disabled, show the cache that is available for the profile
  attemptedFetch.value = false
  loadPostsFromCacheForAllActiveProfileChannels()
}

function loadPostsFromCacheForAllActiveProfileChannels() {
  const forbiddenTitles = store.getters.getForbiddenTitlesParsed
  const postList_ = cacheEntriesForAllActiveProfileChannels.value
    .flatMap(cacheEntry => cacheEntry.posts ?? [])
    .filter(post => !forbiddenTitles.some(text => post.author.toLowerCase().includes(text)))

  postList_.sort((a, b) => {
    return b.publishedTime - a.publishedTime
  })

  postList.value = postList_
  isLoading.value = false
}

// Show the channels that have been fetched so far, instead of waiting for the
// whole refresh to finish
useSubscriptionChannelUpdates('posts', () => {
  if (subscriptionCacheReady.value) {
    loadPostsFromCacheForAllActiveProfileChannels()
  }
})

async function loadPostsForSubscriptionsFromRemote() {
  isLoading.value = true
  attemptedFetch.value = true
  errorChannels.value = []

  // Whatever is cached is shown right away, the refresh then replaces it
  // channel by channel
  if (subscriptionCacheReady.value && cacheEntriesForAllActiveProfileChannels.value.length > 0) {
    loadPostsFromCacheForAllActiveProfileChannels()
  }

  try {
    const refreshedPosts = await refreshSubscriptionPostsFromRemote({
      t,
      errorChannels: errorChannels.value
    })
    if (refreshedPosts !== null) {
      loadPostsFromCacheForAllActiveProfileChannels()
      lastRemoteRefreshSuccessTimestamp.value = store.getters.getSubscriptionPostsLastRefreshTimestamp
    }
  } finally {
    isLoading.value = false
  }
}

defineExpose({
  refresh: loadPostsForSubscriptionsFromRemote,
  isLoading,
  lastRefreshTimestamp: lastPostsRefreshTimestamp,
  nextAutoRefreshTimestamp,
  nextAutoRefreshTooltip,
  refreshTitle,
  hasNewContent
})
</script>
