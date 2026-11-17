import { ref } from 'vue'

/**
 * Requests from outside the Subscriptions page, such as the launcher's Refresh
 * shortcut, live only in memory, so reloads and back navigation cannot repeat
 * them.
 */
const refreshRequested = ref(false)

// A renderer runs one subscription refresh at a time. An automatic one, such
// as when the app resumes, can turn out to fetch nothing, so a request waits
// for it to end instead of counting on it.
const refreshReserved = ref(false)
// SUBSCRIPTION_REFRESH_RESERVED_EVENT from subscriptions.js, which this light
// module cannot import.
globalThis.window?.addEventListener('opentubex-subscription-refresh-reserved', event => {
  refreshReserved.value = event.detail === true
})

export function isSubscriptionRefreshReserved() {
  return refreshReserved.value
}

export function requestSubscriptionFeedRefresh() {
  refreshRequested.value = true
}

/**
 * Called by the Subscriptions page whenever its state changes. A running
 * refresh of the shown feed, such as the automatic one at startup, fulfills the
 * request, and a page without feed tabs drops it.
 * @param {() => { presented: boolean, hasTab: boolean, refreshing: boolean, ready: boolean }} getState
 * @returns {boolean} Whether the page should start a refresh now
 */
export function takeSubscriptionFeedRefreshRequest(getState) {
  if (!refreshRequested.value) return false
  const { presented, hasTab, refreshing, ready } = getState()
  if (!presented) return false
  if (hasTab && !refreshing && !ready) return false
  refreshRequested.value = false
  return hasTab && !refreshing
}
