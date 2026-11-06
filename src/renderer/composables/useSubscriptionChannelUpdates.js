import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, reactive, watch } from 'vue'

import { SUBSCRIPTION_REFRESH_CHANNEL_EVENT } from '../helpers/subscriptions'
import { useTabContext } from '../tabs/TabContext'
import store from '../store/index'
import { getSubscriptionsForFeed } from '../helpers/subscription-channels'

// Rebuilding and sorting the whole feed for every channel would be wasteful
// with hundreds of subscriptions, so updates are coalesced.
const FEED_UPDATE_INTERVAL_MS = 100
// Large refreshes publish in batches. Rebuilding and animating a large list
// after every response can dominate the refresh's CPU cost, so batches wait
// long enough to keep publishing to a small share of the refresh time.
const LARGE_REFRESH_UPDATE_INTERVAL_MS = 2000
const LARGE_REFRESH_IDLE_RATIO = 10
const MAX_INCREMENTAL_CHANNELS = 20
const updateVersions = reactive({
  videos: 0,
  shorts: 0,
  live: 0,
  posts: 0
})

window.addEventListener(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, (event) => {
  if (event.detail.tab in updateVersions) {
    updateVersions[event.detail.tab]++
  }
})

/**
 * Publishes cached channel updates as they arrive, batched for large refreshes.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {() => void} onChannelsRefreshed
 * @param {() => boolean} [isLargeFeed] whether the cached feed is too large to rebuild often
 */
export function useSubscriptionChannelUpdates(tab, onChannelsRefreshed, isLargeFeed = () => false) {
  const { isTabPresented } = useTabContext()
  const isRefreshing = computed(() => store.getters.getSubscriptionFeedRefreshInProgress &&
    store.getters.getSubscriptionFeedRefreshTab === tab)
  let timeout = null
  let lastRun = 0
  let lastPublishDuration = 0
  let publishing = false
  let updatePending = false
  let isActive = true

  function isPresented() {
    return isTabPresented?.value !== false
  }

  function updateInterval() {
    if (isRefreshing.value && (isLargeFeed() ||
      getSubscriptionsForFeed(store.getters.getActiveProfile.subscriptions, tab).length > MAX_INCREMENTAL_CHANNELS)) {
      return Math.max(LARGE_REFRESH_UPDATE_INTERVAL_MS, lastPublishDuration * LARGE_REFRESH_IDLE_RATIO)
    }
    return FEED_UPDATE_INTERVAL_MS
  }

  async function run() {
    timeout = null

    if (!isActive || !isPresented()) {
      return
    }

    updatePending = false
    publishing = true
    const startedAt = Date.now()
    try {
      onChannelsRefreshed()
      // Include rendering the rebuilt list
      await nextTick()
    } finally {
      publishing = false
      lastRun = Date.now()
      lastPublishDuration = lastRun - startedAt
    }

    if (updatePending) {
      schedule()
    }
  }

  function schedule() {
    if (!isActive || !isPresented() || publishing || timeout !== null) {
      return
    }

    const remaining = updateInterval() - (Date.now() - lastRun)
    timeout = setTimeout(run, Math.max(remaining, 0))
  }

  watch(() => updateVersions[tab], () => {
    updatePending = true
    schedule()
  })

  watch(isRefreshing, (refreshing) => {
    // Show the first channel of a new refresh without waiting for a batch
    if (refreshing) {
      lastRun = 0
      return
    }
    // Publish a finished or cancelled refresh without waiting for the batch
    if (!updatePending) return
    clearTimeout(timeout)
    timeout = null
    schedule()
  })

  if (isTabPresented !== null) {
    watch(isTabPresented, (presented) => {
      if (!presented) {
        if (timeout !== null) {
          clearTimeout(timeout)
          timeout = null
        }
        return
      }

      if (updatePending) {
        schedule()
      }
    })
  }

  onActivated(() => {
    isActive = true

    if (updatePending) {
      schedule()
    }
  })

  onDeactivated(() => {
    isActive = false

    if (timeout !== null) {
      clearTimeout(timeout)
      timeout = null
    }
  })

  onBeforeUnmount(() => {
    clearTimeout(timeout)
  })
}
