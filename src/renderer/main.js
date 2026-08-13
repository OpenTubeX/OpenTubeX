import { createApp } from 'vue'
import i18n from './i18n/index'
import router from './router/index'
import store from './store/index'
import App from './App.vue'
import { initializeTabNavigationService } from './tabs/TabNavigationService'
import { showExternalPlayerUnsupportedActionToast, showToast } from './helpers/utils'
import { installViewTransitions } from './helpers/viewTransitions'
import { initializeAppScrollbars, overlayScrollbarsDirective } from './helpers/overlayScrollbars'
// import the styles
import 'overlayscrollbars/styles/overlayscrollbars.css'
// Only the positioning and stacking rules are used, FtToast supplies the design
import 'vue-sonner/style.css'

import { register as registerSwiper } from 'swiper/element'

import { ObserveVisibility } from 'vue-observe-visibility'

import { FtIcon, FtIconLayers } from './icons/iconComponents'
import { currentIconPack, setIconPack } from './icons/iconPackState'
registerSwiper()

const app = createApp(App)

app.config.performance = process.env.NODE_ENV === 'development'

app
  .component('FtIcon', FtIcon)
  .component('FtIconLayers', FtIconLayers)
  .directive('observe-visibility', ObserveVisibility)
  .directive('overlay-scrollbars', overlayScrollbarsDirective)

  .use(router)
  .use(store)
  .use(i18n)

installViewTransitions(router)

const tabNavigation = initializeTabNavigationService(router, store)

router.isReady().then(async () => {
  const preferredPack = currentIconPack.value
  const fallbackPack = preferredPack === 'material' ? 'remix' : 'material'
  if (!await setIconPack(preferredPack) && !await setIconPack(fallbackPack)) {
    console.error('[icon-pack] failed to load either icon pack')
  }
  app.mount('#app')
  initializeAppScrollbars()
})

// to avoid accessing electron api from web app build
if (process.env.IS_ELECTRON) {
  window.ftElectron.handleChangeView((route, tabId) => {
    if (typeof route === 'string' && (route === '/settings' || route.startsWith('/settings/profile'))) {
      store.dispatch('showSettingsWindow', route.startsWith('/settings/profile') ? 'profile' : null)
      return
    }
    const targetTabId = tabId ?? store.getters.getActiveTabId
    if (route && targetTabId) {
      tabNavigation.push(targetTabId, route)
    }
  })

  window.ftElectron.tabs.onGoHistory(({ tabId, offset }) => {
    tabNavigation.go(tabId, offset)
  })

  window.ftElectron.handleOpenInExternalPlayerResult(
    (externalPlayer, unsupportedActions, isPlaylist) => {
      for (const action of unsupportedActions) {
        showExternalPlayerUnsupportedActionToast(externalPlayer, action)
      }

      const videoOrPlaylist = isPlaylist
        ? i18n.global.t('Video.External Player.playlist')
        : i18n.global.t('Video.External Player.video')

      showToast({
        message: i18n.global.t('Video.External Player.OpeningTemplate', { videoOrPlaylist, externalPlayer }),
        icon: ['fas', 'external-link-alt'],
      })
    }
  )

  const removedDownloadIds = new Set()

  window.ftElectron.handleYtDlpDownloadStatus((download) => {
    store.commit('upsertYtDlpDownload', download)

    if (download.status === 'completed') {
      showToast({
        message: i18n.global.t('Downloads.Download Complete Template', { title: download.title }),
        icon: ['fas', 'download'],
      })
    } else if (download.status === 'failed') {
      showToast({
        message: download.errorMessage === 'ENOENT'
          ? i18n.global.t('Downloads.yt-dlp Not Found')
          : i18n.global.t('Downloads.Download Failed Template', { title: download.title }),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  })

  window.ftElectron.handleYtDlpDownloadsRemoved((ids) => {
    for (const id of ids) {
      removedDownloadIds.add(id)
      store.commit('removeYtDlpDownload', id)
    }
  })

  window.ftElectron.ytDlpListDownloads().then(downloads => {
    for (const download of downloads) {
      if (!removedDownloadIds.has(download.id)) store.commit('upsertYtDlpDownload', download)
    }
  }).catch(error => console.warn('Could not load download history', error))
}
