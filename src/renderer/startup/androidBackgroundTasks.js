import { waitForDatastores } from '../../datastores/index'
import i18n from '../i18n/index'
import { finishAndroidBackgroundTasks, setPeriodicBackgroundTask } from '../helpers/androidBackgroundSync.js'
import { suppressWatchedAndroidNotifications } from '../helpers/androidNotificationSuppressions.js'
import { handleRestoredAndroidAppData } from '../helpers/androidStorage.js'
import { checkCommentRepliesInBackground } from '../helpers/commentReplyNotifications.js'
import { loadCustomThemes } from '../helpers/customTheme.js'
import { checkTwitchLiveInBackground } from '../helpers/platformFeed.js'
import { isSyncReasonEnabled } from '../helpers/sync-server-scheduling.js'

/**
 * Runs the background tasks once in the hidden renderer that the periodic job
 * loads while the Android app is closed, without mounting the app. Each task
 * turns itself off when its settings are off.
 * @param {import('vuex').Store<any>} store
 */
export async function runAndroidBackgroundTasks(store) {
  try {
    await waitForDatastores()
    const { hasExistingSettings } = await store.dispatch('grabUserSettings')
    // The loaders report failures instead of throwing. Syncing default data
    // would look like deleting the library, which pauses automatic sync.
    if (hasExistingSettings === null) throw new Error('Unable to load the settings')
    // Restored app data must not sync as the installation it came from.
    await handleRestoredAndroidAppData(store)
    await store.dispatch('loadAndroidProxySettings')
    await Promise.all([
      sync(store),
      checkCommentRepliesInBackground(),
      checkTwitchLiveInBackground(),
    ].map(task => task.catch(error => console.error('Android background task failed', error))))
  } catch (error) {
    console.error('Android background tasks failed', error)
  } finally {
    await finishAndroidBackgroundTasks().catch(() => {})
  }
}

/** @param {import('vuex').Store<any>} store */
async function sync(store) {
  const settings = store.state.settings
  if (!settings.syncServerEnabled || !settings.syncServerToken || !settings.syncServerAutoSync ||
      !isSyncReasonEnabled(settings, 'automatic')) {
    // Automatic sync was turned off without cancelling the task.
    setPeriodicBackgroundTask('sync', false)
    return
  }
  // The sync compares everything it syncs with the last synced state, so
  // anything left unloaded here would look deleted. Load it as App.vue does.
  store.commit('setCustomThemes', await loadCustomThemes())
  const [profilesLoaded, historyLoaded] = await Promise.all([
    store.dispatch('grabAllProfiles', i18n.global.t('Profile.All Channels')),
    store.dispatch('grabHistory'),
    store.dispatch('grabAllPlaylists'),
  ])
  if (profilesLoaded === null || !historyLoaded || !store.state.playlists.playlistsReady) {
    throw new Error('Unable to load the library')
  }
  // Open tabs and live reminders belong to the app's renderer, so they sync
  // when the app opens.
  await store.dispatch('initializeSyncServer')
  // Uploads watched on another device need no notification here.
  await suppressWatchedAndroidNotifications()
}
