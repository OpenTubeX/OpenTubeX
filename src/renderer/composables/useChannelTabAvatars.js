import { watch } from 'vue'
import store from '../store/index'
import { getSyncedTabPreview } from '../tabs/tabPreview'
import { fetchChannelInfo, getCachedChannelInfo } from '../helpers/channel-preferences'
import { mapConcurrently } from '../helpers/concurrent-map'
import { youtubeImageUrlToInvidious } from '../helpers/api/invidious'

/** Load channel avatars only for the tabs currently being displayed. */
export function useChannelTabAvatars(tabs) {
  watch(tabs, async visibleTabs => {
    const channelIds = [...new Set(visibleTabs.map(tab => (
      (tab.route?.path ?? getSyncedTabPreview(tab).route?.path)?.match(/^\/channel\/([^/]+)/)?.[1]
    )).filter(Boolean))]
    await mapConcurrently(channelIds, 4, async channelId => {
      if (store.getters.getChannelThumbnail(channelId)) return
      const options = {
        preference: store.getters.getBackendPreference,
        fallback: store.getters.getBackendFallback,
      }
      const cached = getCachedChannelInfo(channelId, store.getters.getSubscribedChannelsById)
      const info = cached?.thumbnail ? cached : await fetchChannelInfo(channelId, options)
      if (!info?.thumbnail) return
      const thumbnail = options.preference === 'invidious'
        ? youtubeImageUrlToInvidious(info.thumbnail, store.getters.getCurrentInvidiousInstanceUrl)
        : info.thumbnail
      store.commit('setChannelThumbnail', { channelId, thumbnail })
    })
  }, { immediate: true })
}
