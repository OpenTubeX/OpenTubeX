import { waitForDatastores } from '../../datastores/index'
import i18n from '../i18n/index'
import { finishAndroidBackgroundSync, setPeriodicBackgroundSync } from '../helpers/androidBackgroundSync.js'
import { handleRestoredAndroidAppData } from '../helpers/androidStorage.js'
import { loadCustomThemes } from '../helpers/customTheme.js'
import { isSyncReasonEnabled } from '../helpers/sync-server-scheduling.js'

/**
 * Syncs once in the hidden renderer that the periodic job loads while the
 * Android app is closed, without mounting the app.
 * @param {import('vuex').Store<any>} store
 */
export async function runAndroidBackgroundSync(store) {
  try {
    await waitForDatastores()
    const { hasExistingSettings } = await store.dispatch('grabUserSettings')
    // The loaders report failures instead of throwing. Syncing default data
    // would look like deleting the library, which pauses automatic sync.
    if (hasExistingSettings === null) throw new Error('Unable to load the settings')
    // Restored app data must not sync as the installation it came from.
    await handleRestoredAndroidAppData(store)
    const settings = store.state.settings
    if (!settings.syncServerEnabled || !settings.syncServerToken || !settings.syncServerAutoSync ||
        !isSyncReasonEnabled(settings, 'automatic')) {
      // Automatic sync was turned off without cancelling the job.
      setPeriodicBackgroundSync(false)
      return
    }
    await store.dispatch('loadAndroidProxySettings')
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
    // Open tabs, live reminders and notifications belong to the app's
    // renderer, so they sync when the app opens.
    await store.dispatch('initializeSyncServer')
  } catch (error) {
    console.error('Android background sync failed', error)
  } finally {
    await finishAndroidBackgroundSync().catch(() => {})
  }
}
