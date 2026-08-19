import { onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'

import { SUBSCRIPTION_REFRESH_CHANNEL_EVENT } from '../helpers/subscriptions'
import { useTabContext } from '../tabs/TabContext'

// Rebuilding and sorting the whole feed for every channel would be wasteful
// with hundreds of subscriptions, so updates are coalesced.
const FEED_UPDATE_INTERVAL_MS = 500

/**
 * Runs the callback while a refresh of the given feed is in progress, whenever
 * newly fetched channels have been added to its cache.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {() => void} onChannelsRefreshed
 */
export function useSubscriptionChannelUpdates(tab, onChannelsRefreshed) {
  const { isTabPresented } = useTabContext()
  let timeout = null
  let lastRun = 0
  let updatePending = false
  let isActive = true

  function isPresented() {
    return isTabPresented?.value !== false
  }

  function run() {
    timeout = null

    if (!isActive || !isPresented()) {
      return
    }

    updatePending = false
    lastRun = Date.now()
    onChannelsRefreshed()
  }

  function schedule() {
    if (!isActive || !isPresented() || timeout !== null) {
      return
    }

    const remaining = FEED_UPDATE_INTERVAL_MS - (Date.now() - lastRun)
    timeout = setTimeout(run, Math.max(remaining, 0))
  }

  /**
   * @param {CustomEvent<{tab: string}>} event
   */
  function handleChannelRefreshed(event) {
    if (event.detail.tab !== tab) {
      return
    }

    updatePending = true
    schedule()
  }

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

  onMounted(() => {
    window.addEventListener(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, handleChannelRefreshed)

    if (updatePending) {
      schedule()
    }
  })

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
    window.removeEventListener(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, handleChannelRefreshed)
    clearTimeout(timeout)
  })
}
