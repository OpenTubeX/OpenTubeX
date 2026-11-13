import { computed, watch } from 'vue'

import { isAppHidden } from '../helpers/appVisibility.js'

/** The longest delay that `setTimeout` takes */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/**
 * @typedef {object} AutoRefreshedFeed
 * @property {string} lockName Held by the window that refreshes the feed
 * @property {() => number} getInterval In milliseconds, 0 while it doesn't apply
 * @property {import('vue').Ref<number | null>} nextAutoRefresh The shared deadline
 * @property {() => number | null} loadNextAutoRefresh The deadline in storage
 * @property {(timestamp: number | null) => void} setNextAutoRefresh Stores the deadline
 * @property {import('vue').Ref<boolean>} refreshing
 * @property {() => Promise<unknown>} refresh An automatic refresh of the feed
 */

/**
 * Refreshes a feed on its configured interval while the app is open and
 * visible. Windows share the deadline, so only one of them refreshes.
 * @param {import('vue').Ref<boolean>} dataReady Whether the settings have loaded
 * @param {AutoRefreshedFeed} feed
 */
export function useFeedAutoRefresh(dataReady, feed) {
  let timer = null
  const interval = computed(() => feed.getInterval())

  // A changed interval starts over, a deadline from before a restart stays
  watch(interval, (value) => {
    if (dataReady.value) feed.setNextAutoRefresh(value > 0 ? Date.now() + value : null)
  })
  watch([dataReady, interval, feed.nextAutoRefresh], schedule)

  function schedule() {
    clearTimeout(timer)
    timer = null
    if (!dataReady.value || interval.value <= 0) return

    const deadline = feed.nextAutoRefresh.value
    if (deadline === null) {
      // Schedules again through the watcher
      feed.setNextAutoRefresh(Date.now() + interval.value)
      return
    }
    // Later deadlines would overflow the timer, which then fires right away
    timer = setTimeout(refreshIfDue, Math.min(Math.max(0, deadline - Date.now()), MAX_TIMER_DELAY_MS))
  }

  async function refreshIfDue() {
    timer = null
    // Continues once the app is visible and online again
    if (isAppHidden() || navigator.onLine === false) return

    await navigator.locks.request(feed.lockName, async () => {
      // Another window may have refreshed it before its storage event arrived
      const deadline = feed.loadNextAutoRefresh()
      if (deadline !== null && deadline > Date.now()) {
        feed.nextAutoRefresh.value = deadline
        schedule()
        return
      }
      if (interval.value <= 0) return
      // A running refresh counts as this one. It sets the next deadline again if
      // it refreshes everything, and a partial or cancelled one keeps this one.
      if (feed.refreshing.value) {
        feed.setNextAutoRefresh(Date.now() + interval.value)
        return
      }

      // Claimed before the refresh, which can fail or be replaced by a manual one
      feed.setNextAutoRefresh(Date.now() + interval.value)
      try {
        await feed.refresh()
      } catch (error) {
        console.error('Failed to refresh a feed on its interval', error)
      }
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
