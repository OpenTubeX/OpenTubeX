import store from '../store/index'
import { suppressAndroidNotifications } from './androidBackgroundSync.js'
import { capacitorNotificationHistory } from './capacitorNotificationHistory.js'
import { closeCapacitorSystemNotifications, suppressDismissedAndroidNotifications } from './capacitorSystemNotifications.js'

// Android announces uploads up to a week old, so older watches cannot match one.
const WATCHED_WINDOW_MS = 8 * 24 * 60 * 60 * 1000
const WATCHED_LIMIT = 1000

/**
 * @param {{ videoId: string, timeWatched: number }[]} history newest first
 * @returns {string[]}
 */
function getRecentlyWatchedIds(history) {
  const since = Date.now() - WATCHED_WINDOW_MS
  const ids = []
  for (const { videoId, timeWatched } of history) {
    if (ids.length === WATCHED_LIMIT || !(timeWatched >= since)) break
    ids.push(videoId)
  }
  return ids
}

/** Keeps Android from announcing videos in the watch history, also ones watched on another device. */
export function suppressWatchedAndroidNotifications() {
  return suppressAndroidNotifications({ watched: getRecentlyWatchedIds(store.state.history.historyCacheSorted) })
}

/**
 * Keeps Android from announcing what the user already watched, read or
 * removed, and removes such notifications it showed. The renderer that syncs
 * while the app is closed updates both after its sync.
 * @returns {() => void} stops following the watch history
 */
export function startAndroidNotificationSuppressions() {
  if (!process.env.IS_CAPACITOR || process.env.IS_IOS) return () => {}
  capacitorNotificationHistory.getDismissals().then(suppressDismissedAndroidNotifications)
  // That renderer cannot remove the reminders whose entries its sync marked read.
  capacitorNotificationHistory.list()
    .then(entries => closeCapacitorSystemNotifications(entries.filter(entry => entry.read && entry.kind === 'live-reminder')))
  return store.watch(
    state => getRecentlyWatchedIds(state.history.historyCacheSorted).join('\n'),
    ids => suppressAndroidNotifications({ watched: ids ? ids.split('\n') : [] }),
    { immediate: true }
  )
}
