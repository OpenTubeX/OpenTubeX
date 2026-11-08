import { registerPlugin } from '@capacitor/core'

import { createContinueWatchingWidgetVideos } from './homeWidgetData'
import { getVideoThumbnailUrl } from './utils'

const HomeWidgets = process.env.IS_CAPACITOR ? registerPlugin('HomeWidgets') : null

/**
 * Keeps the native widget cache in sync with Continue watching. Thumbnails
 * follow the hidden and blurred thumbnail settings; widgets never fetch data.
 * @param {import('vuex').Store} store
 * @param {typeof import('vue').watch} watch
 * @returns {() => void}
 */
export function syncContinueWatchingWidget(store, watch) {
  if (!HomeWidgets) return () => {}
  let timeout = null
  let lastSnapshot = null
  const update = () => {
    const { getThumbnailPreference: preference, getBlurThumbnails: blurred } = store.getters
    const videos = createContinueWatchingWidgetVideos(store.getters.getContinueWatchingHistory(), videoId => {
      if (blurred) return null
      // Widgets show small images; maxresdefault is large and often missing.
      return getVideoThumbnailUrl(videoId, store.getters.getBackendPreference,
        store.getters.getCurrentInvidiousInstanceUrl, preference)?.replace(/\/maxresdefault\.jpg$/, '/mqdefault.jpg')
    })
    // Native downloads send this only to the instance's own origin.
    const authorization = store.getters.getBackendPreference === 'invidious' && store.getters.getCurrentInvidiousInstanceAuthorization
      ? { url: store.getters.getCurrentInvidiousInstanceUrl, value: store.getters.getCurrentInvidiousInstanceAuthorization }
      : null
    const snapshot = JSON.stringify({ videos, authorization })
    if (snapshot === lastSnapshot) return
    lastSnapshot = snapshot
    HomeWidgets.setContinueWatching({ videos, authorization }).catch(error => console.error('Failed to update home screen widgets', error))
  }
  const stop = watch(() => [
    store.state.history.continueWatchingRevision,
    store.getters.getThumbnailPreference,
    store.getters.getBlurThumbnails,
    store.getters.getBackendPreference,
    store.getters.getCurrentInvidiousInstanceUrl,
    store.getters.getCurrentInvidiousInstanceAuthorization,
  ], ([revision]) => {
    clearTimeout(timeout)
    // Revision 0 means history has not loaded yet; keep the last cached list.
    if (revision > 0) timeout = setTimeout(update, 1000)
  }, { immediate: true })
  return () => {
    clearTimeout(timeout)
    stop()
  }
}
