import './i18n/startupLocales'
import { ytDlp } from './helpers/ytDlp'
import { supportsYtDlp } from './helpers/ytDlpCapabilities'
import { createApp } from 'vue'
import { installNetworkFetch } from './helpers/networkRecovery'
import i18n from './i18n/index'
import router from './router/index'
import store from './store/index'
import { settingWritesSettled } from './store/modules/settings'
import App from './App.vue'
import { initializeTabNavigationService } from './tabs/TabNavigationService'
import { showToast } from './helpers/utils'
import { installViewTransitions } from './helpers/viewTransitions'
import { installTitleTooltips } from './helpers/titleTooltips'
import { initializeAppScrollbars, overlayScrollbarsDirective } from './helpers/overlayScrollbars'
import { releaseAutomaticDownloadSchedule } from './helpers/automaticDownloads'
import { recordNotification, removeDownloadNotifications, withThumbnail } from './helpers/notificationHistory'
import { getDownloadTarget } from '../notificationHistory'
import { initializeAndroidDynamicColors } from './helpers/dynamicColors'
import { observeAndroidNetworkMetered } from './helpers/androidUi'
import './helpers/reducedTransparency'
import { networkMetered } from './helpers/player/meteredNetworkQuality'
import { isAndroidBackgroundRenderer } from './helpers/androidBackgroundSync'
// import the styles
import './helpers/overlayScrollbars.css'
// Only the positioning and stacking rules are used, FtToast supplies the design
import 'vue-sonner/style.css'
import './helpers/anchoredPosition.css'
import './helpers/titleTooltips.css'
import './helpers/gridReorder.css'

import { FtIcon, FtIconLayers } from './icons/iconComponents'

installNetworkFetch({
  checkInternet: true,
  // Load the persisted privacy choice before sending the first probe.
  internetChecksEnabled: false,
  corsDisabled: process.env.IS_ELECTRON,
  getRequestError: process.env.IS_ELECTRON ? url => window.ftElectron.getRequestError(url) : undefined
})

const app = createApp(App)

app.config.performance = process.env.NODE_ENV === 'development'

app
  .component('FtIcon', FtIcon)
  .component('FtIconLayers', FtIconLayers)
  .directive('overlay-scrollbars', overlayScrollbarsDirective)

  .use(router)
  .use(store)
  .use(i18n)

installViewTransitions(router)
installTitleTooltips()

const tabNavigation = initializeTabNavigationService(router, store)

if (isAndroidBackgroundRenderer) {
  // Loaded only here, as its datastore import would load NeDB at startup,
  // which throws in the desktop app.
  import('./startup/androidBackgroundTasks').then(({ runAndroidBackgroundTasks }) => runAndroidBackgroundTasks(store))
} else {
  startApp()
}

let mounted = false

/**
 * Shows why the library cannot be used, without reading or writing app storage.
 * @param {{ inUseElsewhere?: boolean }} [props]
 */
async function showStorageScreen(props) {
  // Use the system locale. A failed locale or region request must not keep the screen hidden.
  await store.dispatch('triggerCurrentLocaleSideEffects', 'system').catch(console.error)
  const { setIconPack } = await import('./icons/iconPackState')
  await setIconPack('material')
  const { default: StorageStartupError } = await import('./components/StorageStartupError/StorageStartupError.vue')
  createApp(StorageStartupError, props).use(i18n).mount('#app')
  document.getElementById('startup-splash')?.remove()
  document.getElementById('app')?.removeAttribute('inert')
}

function startApp() {
  // Read the initial state before a restored Watch page picks its starting quality,
  // but don't let a missing answer prevent the application from mounting.
  let networkMeteredTimeout
  const networkMeteredReady = Promise.race([
    observeAndroidNetworkMetered(metered => { networkMetered.value = metered }).catch(error => {
      console.error('Failed to observe metered networks:', error)
    }),
    new Promise(resolve => { networkMeteredTimeout = setTimeout(resolve, 1500) }),
  ]).finally(() => clearTimeout(networkMeteredTimeout))

  // Resolve native colors before App applies its first theme and system-bar style.
  const dynamicColorsReady = process.env.IS_CAPACITOR
    ? initializeAndroidDynamicColors().catch(error => {
        console.error('Failed to load initial Android dynamic colors:', error)
      })
    : Promise.resolve()

  // On Android, start opening the native SQLite datastores right away in parallel
  // with router, dynamic colors, and network state instead of waiting for them.
  const androidDatastoresReady = process.env.IS_CAPACITOR && !process.env.IS_IOS
    ? import('../datastores/index').then(({ waitForDatastores }) => waitForDatastores())
    : null
  // Prevent an unhandled rejection if the earlier Promise.all takes another turn.
  androidDatastoresReady?.catch(() => {})

  Promise.all([router.isReady(), dynamicColorsReady, networkMeteredReady]).then(async () => {
    // The web app's library lives in browser storage, which can be unavailable
    // (plain http:// addresses) or held by another tab.
    if (process.env.IS_CAPACITOR ? !process.env.IS_IOS : !process.env.IS_ELECTRON) {
      try {
        if (!process.env.IS_CAPACITOR) {
          // A new tab takes the library over from the tab that has it.
          const { libraryInUseElsewhere, onLibraryTakenOver } = await import('../datastores/libraryHandover')
          if (await libraryInUseElsewhere()) {
            await showStorageScreen({ inUseElsewhere: true })
            return
          }
          // Pages save their progress on beforeunload, while their player is
          // still there. Unmounting stops the rest before the library closes.
          onLibraryTakenOver(async () => {
            if (mounted) {
              window.dispatchEvent(new Event('beforeunload'))
              app.unmount()
            }
            // A setting can wait for other work, such as loading an icon pack, before it's saved.
            const timedOut = new Promise(resolve => setTimeout(() => resolve(true), 3000))
            for (let pending = settingWritesSettled(); pending; pending = settingWritesSettled()) {
              if (await Promise.race([pending.then(() => false, () => false), timedOut])) break
            }
          })
        }
        if (androidDatastoresReady) {
          await androidDatastoresReady
        } else {
          const { waitForDatastores } = await import('../datastores/index')
          await waitForDatastores()
        }
      } catch (error) {
        console.error('App storage is unavailable:', error)
        await showStorageScreen()
        return
      }
    }
    mounted = true
    app.mount('#app')
    initializeAppScrollbars({ useNativePageScrollbar: process.env.IS_CAPACITOR })
  })
}

// to avoid accessing electron api from web app build
if (process.env.IS_ELECTRON) {
  window.ftElectron.handleShowSettingsWindow((view, toggle) => {
    const settingsWindowOpen = store.getters.getSettingsWindowOpen &&
      !['about', 'downloads'].includes(store.getters.getSettingsWindowView)
    if (toggle && settingsWindowOpen) {
      store.dispatch('hideSettingsWindow')
    } else {
      store.dispatch('showSettingsWindow', view)
    }
  })

  window.ftElectron.handleChangeView((route, tabId) => {
    const targetTabId = tabId ?? store.getters.getActiveTabId
    if (route && targetTabId) {
      tabNavigation.push(targetTabId, route)
    }
  })

  window.ftElectron.tabs.onGoHistory(({ tabId, offset }) => {
    tabNavigation.go(tabId, offset)
  })
}

if (supportsYtDlp && !isAndroidBackgroundRenderer) {
  const removedDownloadIds = new Set()

  ytDlp.handleYtDlpDownloadStatus((download) => {
    store.commit('upsertYtDlpDownload', download)
    releaseAutomaticDownloadSchedule(download)
    // The entry that announced the start is over once the download ended.
    if (['completed', 'failed', 'cancelled', 'skipped'].includes(download.status)) {
      removeDownloadNotifications([download.id], ['download-started'])
    }

    if ((download.status === 'completed' || download.status === 'failed') && download.automatic !== true) {
      const completed = download.status === 'completed'
      const message = completed
        ? i18n.global.t('Downloads.Download Complete Template', { title: download.title })
        : download.errorMessage === 'ENOENT'
          ? i18n.global.t('Downloads.yt-dlp Not Found')
          : i18n.global.t('Downloads.Download Failed Template', { title: download.title })
      showToast({ message, icon: completed ? ['fas', 'download'] : ['fas', 'circle-exclamation'] })
      // The desktop app's main process keeps these in the bell, once for every tab.
      if (process.env.IS_CAPACITOR) {
        recordNotification({
          ...getDownloadTarget(completed ? 'completed' : 'failed', download.videoId, download.id, download.mode),
          title: completed ? i18n.global.t('Downloads.Download Complete') : i18n.global.t('Downloads.Download Failed'),
          body: message,
          ...(typeof download.videoId === 'string' && download.videoId ? withThumbnail(download.videoId) : {})
        })
      }
    }
  })

  ytDlp.handleYtDlpDownloadsRemoved((ids) => {
    // Their entries lead nowhere now, and a retried download has a new ID.
    removeDownloadNotifications(ids)
    for (const id of ids) {
      removedDownloadIds.add(id)
      store.commit('removeYtDlpDownload', id)
    }
  })

  ytDlp.ytDlpListDownloads().then(downloads => {
    for (const download of downloads) {
      if (!removedDownloadIds.has(download.id)) store.commit('upsertYtDlpDownload', download)
    }
    store.commit('setYtDlpDownloadsLoaded')
  }).catch(error => console.warn('Could not load download history', error))
}
