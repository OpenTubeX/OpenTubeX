import { onBeforeUnmount, onMounted } from 'vue'

import { SUBSCRIPTION_REFRESH_CHANNEL_EVENT } from '../helpers/subscriptions'

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
  let timeout = null
  let lastRun = 0

  function run() {
    timeout = null
    lastRun = Date.now()
    onChannelsRefreshed()
  }

  /**
   * @param {CustomEvent<{tab: string}>} event
   */
  function handleChannelRefreshed(event) {
    if (event.detail.tab !== tab || timeout !== null) {
      return
    }

    const remaining = FEED_UPDATE_INTERVAL_MS - (Date.now() - lastRun)

    if (remaining <= 0) {
      run()
    } else {
      timeout = setTimeout(run, remaining)
    }
  }

  onMounted(() => {
    window.addEventListener(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, handleChannelRefreshed)
  })

  onBeforeUnmount(() => {
    window.removeEventListener(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, handleChannelRefreshed)
    clearTimeout(timeout)
  })
}
