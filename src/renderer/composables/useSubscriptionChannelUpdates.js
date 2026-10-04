import { computed, onActivated, onBeforeUnmount, onDeactivated, reactive, watch } from 'vue'

import { SUBSCRIPTION_REFRESH_CHANNEL_EVENT } from '../helpers/subscriptions'
import { useTabContext } from '../tabs/TabContext'
import store from '../store/index'
import { getSubscriptionsForFeed } from '../helpers/subscription-channels'

// Rebuilding and sorting the whole feed for every channel would be wasteful
// with hundreds of subscriptions, so updates are coalesced.
const FEED_UPDATE_INTERVAL_MS = 100
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
 * Publishes cached channel updates incrementally for small refreshes and at
 * completion or cancellation for large refreshes.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {() => void} onChannelsRefreshed
 */
export function useSubscriptionChannelUpdates(tab, onChannelsRefreshed) {
  const { isTabPresented } = useTabContext()
  const deferDuringRefresh = computed(() => store.getters.getSubscriptionFeedRefreshInProgress &&
    store.getters.getSubscriptionFeedRefreshTab === tab &&
    getSubscriptionsForFeed(store.getters.getActiveProfile.subscriptions, tab).length > MAX_INCREMENTAL_CHANNELS)
  let timeout = null
  let lastRun = 0
  let updatePending = false
  let isActive = true

  function isPresented() {
    return isTabPresented?.value !== false
  }

  function run() {
    timeout = null

    if (!isActive || !isPresented() || deferDuringRefresh.value) {
      return
    }

    updatePending = false
    lastRun = Date.now()
    onChannelsRefreshed()
  }

  function schedule() {
    if (!isActive || !isPresented() || deferDuringRefresh.value || timeout !== null) {
      return
    }

    const remaining = FEED_UPDATE_INTERVAL_MS - (Date.now() - lastRun)
    timeout = setTimeout(run, Math.max(remaining, 0))
  }

  watch(() => updateVersions[tab], () => {
    updatePending = true
    schedule()
  })

  // Large refreshes still persist every response and report progress, but
  // rebuilding/animating the visible list repeatedly can dominate their CPU
  // cost. Publish its pending cache changes when finished or cancelled.
  watch(deferDuringRefresh, deferred => {
    if (!deferred && updatePending) schedule()
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
