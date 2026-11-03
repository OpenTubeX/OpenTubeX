import { computed, watch } from 'vue'

import store from '../store/index'
import { isAppHidden } from '../helpers/appVisibility.js'
import {
  getRssFeedsAutoRefreshInterval,
  loadRssFeedsNextAutoRefresh,
  refreshRssFeeds,
  rssFeedsNextAutoRefresh,
  rssFeedsRefreshing,
  setRssFeedsNextAutoRefresh
} from '../helpers/rssFeeds'

const LOCK_NAME = 'opentubex-rss-feeds-auto-refresh'

/**
 * Refreshes the followed RSS feeds on their configured interval while the app
 * is open and visible. Windows share the deadline, so only one of them refreshes.
 * @param {import('vue').Ref<boolean>} dataReady Whether the settings have loaded
 */
export function useRssFeedAutoRefresh(dataReady) {
  let timer = null
  const interval = computed(() => getRssFeedsAutoRefreshInterval())

  // A changed interval starts over, a deadline from before a restart stays
  watch(interval, (value) => {
    if (dataReady.value) setRssFeedsNextAutoRefresh(value > 0 ? Date.now() + value : null)
  })
  watch([dataReady, interval, rssFeedsNextAutoRefresh], schedule)

  function schedule() {
    clearTimeout(timer)
    timer = null
    if (!dataReady.value || interval.value <= 0) return

    const deadline = rssFeedsNextAutoRefresh.value
    if (deadline === null) {
      // Schedules again through the watcher
      setRssFeedsNextAutoRefresh(Date.now() + interval.value)
      return
    }
    timer = setTimeout(refreshIfDue, Math.max(0, deadline - Date.now()))
  }

  async function refreshIfDue() {
    timer = null
    // Continues once the app is visible and online again
    if (isAppHidden() || navigator.onLine === false) return

    await navigator.locks.request(LOCK_NAME, async () => {
      // Another window may have refreshed them before its storage event arrived
      const deadline = loadRssFeedsNextAutoRefresh()
      if (deadline !== null && deadline > Date.now()) {
        rssFeedsNextAutoRefresh.value = deadline
        schedule()
        return
      }
      // A manual refresh sets the next deadline once it finishes
      if (rssFeedsRefreshing.value || interval.value <= 0) return

      // Claimed before the refresh, which can fail or be replaced by a manual one
      setRssFeedsNextAutoRefresh(Date.now() + interval.value)
      await refreshRssFeeds(store.getters.getFollowedRssFeeds, { automatic: true })
    })
  }

  function refreshIfOverdue() {
    if (!isAppHidden() && timer === null) schedule()
  }

  function start() {
    document.addEventListener('visibilitychange', refreshIfOverdue)
    window.addEventListener('online', refreshIfOverdue)
    schedule()
  }

  function stop() {
    clearTimeout(timer)
    timer = null
    document.removeEventListener('visibilitychange', refreshIfOverdue)
    window.removeEventListener('online', refreshIfOverdue)
  }

  return { start, stop }
}
