import { registerPlugin } from '@capacitor/core'

import { createContinueWatchingWidgetVideos, createDownloadWidgetItems, createWatchTimeWidgetDays, isYouTubeThumbnailUrl } from './homeWidgetData'
import { limitWatchSecondsByDate } from './sync-watch-stats'
import { getVideoThumbnailUrl } from './utils'
import { supportsYtDlp } from './ytDlpCapabilities'

const HomeWidgets = process.env.IS_CAPACITOR ? registerPlugin('HomeWidgets') : null

/**
 * Keeps the native widget caches in sync with Continue watching, downloads and
 * watch statistics. Thumbnails follow the hidden and blurred thumbnail
 * settings; widgets never fetch data.
 * @param {import('vuex').Store} store
 * @param {typeof import('vue').watch} watch
 * @returns {() => void}
 */
export function syncHomeWidgets(store, watch) {
  if (!HomeWidgets) return () => {}
  const { getters } = store
  const videoThumbnail = videoId => {
    if (getters.getBlurThumbnails) return null
    // Widgets show small images; maxresdefault is large and often missing.
    return getVideoThumbnailUrl(videoId, getters.getBackendPreference,
      getters.getCurrentInvidiousInstanceUrl, getters.getThumbnailPreference)?.replace(/\/maxresdefault\.jpg$/, '/mqdefault.jpg')
  }
  // Native downloads send this only to the instance's own origin.
  const authorization = () => getters.getBackendPreference === 'invidious' && getters.getCurrentInvidiousInstanceAuthorization
    ? { url: getters.getCurrentInvidiousInstanceUrl, value: getters.getCurrentInvidiousInstanceAuthorization }
    : null

  const stops = [
    syncWidget(watch, 'setContinueWatching', () => {
      // Revision 0 means history has not loaded yet; keep the last cached list.
      if (store.state.history.continueWatchingRevision === 0) return null
      return {
        videos: createContinueWatchingWidgetVideos(getters.getContinueWatchingHistory(), videoThumbnail),
        authorization: authorization(),
      }
    }),
    syncWidget(watch, 'setWatchTime', () => {
      // Turning statistics off clears the widget even if they never loaded.
      if (!getters.getRememberHistory || !getters.getEnableWatchStats) return { days: {} }
      if (!store.state.watchStats.watchStatsLoaded) return null
      return { days: createWatchTimeWidgetDays(limitWatchSecondsByDate(getters, 'all')) }
    }),
  ]
  if (supportsYtDlp) {
    stops.push(syncWidget(watch, 'setDownloads', () => {
      // Keep the cached list until the download history has loaded.
      if (!store.state.downloads.ytDlpDownloadsLoaded) return null
      return {
        downloads: createDownloadWidgetItems(Object.values(getters.getYtDlpDownloads), download => {
          if (getters.getBlurThumbnails || getters.getThumbnailPreference === 'hidden') return null
          // Single videos follow the thumbnail settings; playlists keep YouTube's own image.
          if (download.videoId && !download.playlistId) return videoThumbnail(download.videoId)
          return isYouTubeThumbnailUrl(download.thumbnail) ? download.thumbnail : null
        }),
        authorization: authorization(),
      }
    }))
  }
  return () => stops.forEach(stop => stop())
}

/**
 * Sends a widget's data a second after it changes. `build` returns null until
 * its data has loaded, so the widget keeps its last cache.
 * @param {typeof import('vue').watch} watch
 * @param {string} method
 * @param {() => object | null} build
 */
function syncWidget(watch, method, build) {
  let timeout = null
  const stop = watch(() => {
    const data = build()
    return data && JSON.stringify(data)
  }, snapshot => {
    clearTimeout(timeout)
    if (snapshot) {
      timeout = setTimeout(() => {
        HomeWidgets[method](JSON.parse(snapshot)).catch(error => console.error('Failed to update home screen widgets', error))
      }, 1000)
    }
  }, { immediate: true })
  return () => {
    clearTimeout(timeout)
    stop()
  }
}
