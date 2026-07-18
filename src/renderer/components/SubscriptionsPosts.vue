<template>
  <SubscriptionsTabUi
    ref="tabUi"
    :is-loading="isLoading"
    :video-list="postList"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    :is-community="true"
    :initial-data-limit="20"
    @refresh="loadPostsForSubscriptionsFromRemote"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { getRelativeTimeFromDate } from '../helpers/utils'
import { refreshSubscriptionPostsFromRemote } from '../helpers/subscriptions'

const { locale, t } = useI18n()
const tabUi = useTemplateRef('tabUi')

const isLoading = ref(true)
const postList = shallowRef([])
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
    return getRelativeTimeFromDate(lastRemoteRefreshSuccessTimestamp.value, true)
  }

  if (
    !postCacheForAllActiveProfileChannelsPresent.value ||
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
  return t('Global.Posts')
})

const hasVisibleNewContent = computed(() => tabUi.value?.hasVisibleNewContent === true)

const nextAutoRefreshTimestamp = computed(() => {
  const timestamp = store.getters.getSubscriptionPostsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionPostsAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  return new Intl.DateTimeFormat([locale.value, 'en'], {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(timestamp)
})

const nextAutoRefreshTooltip = computed(() => {
  const timestamp = store.getters.getSubscriptionPostsNextAutoRefreshTimestamp
  const interval = parseInt(store.getters.getSubscriptionPostsAutoRefreshInterval, 10)

  if (!timestamp || Number.isNaN(interval) || interval <= 0) {
    return ''
  }

  const relativeTime = getRelativeTimeValue(timestamp - now.value)

  return new Intl.RelativeTimeFormat([locale.value, 'en'], { numeric: 'auto' }).format(
    relativeTime.value,
    relativeTime.unit
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
  loadPostsFromCacheSometimes()
}, { deep: true })

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
  nextAutoRefreshTicker = setInterval(() => {
    now.value = Date.now()
  }, 30000)
  loadPostsFromRemoteFirstPerWindowSometimes()
})

onBeforeUnmount(() => {
  clearInterval(nextAutoRefreshTicker)
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
    loadPostsFromCacheForAllActiveProfileChannels()
    return
  }

  if (fetchSubscriptionsAutomatically.value) {
    // `isLoading.value = false` is called inside `loadPostsForSubscriptionsFromRemote` when needed
    loadPostsForSubscriptionsFromRemote()
    return
  }

  // Auto fetch disabled, not enough cache for profile = show nothing
  postList.value = []
  attemptedFetch.value = false
  isLoading.value = false
}

/** @type {import('vue').ComputedRef<string[]>} */
const forbiddenTitles = computed(() => {
  return JSON.parse(store.getters.getForbiddenTitles.toLowerCase())
})

function loadPostsFromCacheForAllActiveProfileChannels() {
  const postList_ = cacheEntriesForAllActiveProfileChannels.value.flatMap((cacheEntry) => {
    return cacheEntry.posts
  })

  postList_.sort((a, b) => {
    return b.publishedTime - a.publishedTime
  })

  postList.value = postList_.filter(post => !forbiddenTitles.value.some(text => post.author.toLowerCase().includes(text)))
  isLoading.value = false
}

async function loadPostsForSubscriptionsFromRemote() {
  if (store.getters.getSubscriptionFeedRefreshInProgress) {
    return
  }

  isLoading.value = true
  attemptedFetch.value = true
  errorChannels.value = []
  try {
    const refreshedPosts = await refreshSubscriptionPostsFromRemote({
      t,
      errorChannels: errorChannels.value
    })
    if (refreshedPosts !== null) {
      postList.value = refreshedPosts
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
  hasVisibleNewContent
})
</script>
