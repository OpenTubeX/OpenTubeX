import { DBHistoryHandlers } from '../../datastores/handlers/index'
import store from '../store/index'
import { suppressAndroidNotifications } from './androidBackgroundSync.js'
import { capacitorNotificationHistory } from './capacitorNotificationHistory.js'
import { closeDeferredReminders, suppressDismissedAndroidNotifications } from './capacitorSystemNotifications.js'

// Android announces uploads up to a week old, so older watches cannot match one.
const WATCHED_WINDOW_MS = 8 * 24 * 60 * 60 * 1000
const WATCHED_LIMIT = 1000

/**
 * @param {{ videoId: string, timeWatched: number }[]} history newest first
 * @returns {string[]}
 */
function getRecentlyWatchedStoreIds(history) {
  const since = Date.now() - WATCHED_WINDOW_MS
  const ids = []
  for (const { videoId, timeWatched } of history) {
    if (ids.length === WATCHED_LIMIT || !(timeWatched >= since)) break
    ids.push(videoId)
  }
  return ids
}

/**
 * The videos watched recently in any profile, newest first. Notifications
 * cover the channels of every profile, while the store only holds the history
 * of one data scope.
 * @returns {Promise<string[]>}
 */
async function getRecentlyWatchedIds() {
  const entries = await DBHistoryHandlers.findRecentlyWatchedInEveryScope(Date.now() - WATCHED_WINDOW_MS, WATCHED_LIMIT)
  entries.sort((a, b) => b.timeWatched - a.timeWatched)
  return [...new Set(entries.map(entry => entry.videoId))].slice(0, WATCHED_LIMIT)
}

/** Keeps Android from announcing videos in the watch history, also ones watched on another device. */
export async function suppressWatchedAndroidNotifications() {
  return suppressAndroidNotifications({ watched: await getRecentlyWatchedIds() })
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
  closeDeferredReminders()
  let update = Promise.resolve()
  // Reads the histories again when a video joins or leaves the recent history
  // the store shows, or when separate profiles come or go. Datastore reads
  // queue behind the history writes the store reflects.
  return store.watch(
    state => [
      ...state.profiles.profileList.filter(profile => profile.separate === true).map(profile => profile._id),
      ...getRecentlyWatchedStoreIds(state.history.historyCacheSorted),
    ].join('\n'),
    () => {
      update = update.then(suppressWatchedAndroidNotifications).catch(error => console.error(error))
    },
    { immediate: true }
  )
}
