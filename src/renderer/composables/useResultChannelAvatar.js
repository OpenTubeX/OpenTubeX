import { onBeforeUnmount, ref, watch } from 'vue'

import store from '../store/index'

import { youtubeImageUrlToInvidious } from '../helpers/api/invidious'
import { fetchChannelInfo, getCachedChannelInfo } from '../helpers/channel-preferences'
import { getResultAuthorThumbnailUrl } from '../helpers/result-channel-avatar'

/**
 * Resolves the channel avatar for a video or playlist result.
 * @param {import('vue').Ref<object>} result
 * @param {import('vue').Ref<string | null>} channelId
 * @param {import('vue').ComputedRef<boolean>} enabled
 */
export function useResultChannelAvatar(result, channelId, enabled) {
  const channelThumbnail = ref(null)
  let loadGeneration = 0

  function normalizeThumbnail(url) {
    if (typeof url !== 'string' || url === '') {
      return null
    }

    const normalizedUrl = url.startsWith('//') ? `https:${url}` : url
    return store.getters.getBackendPreference === 'invidious'
      ? youtubeImageUrlToInvidious(normalizedUrl, store.getters.getCurrentInvidiousInstanceUrl)
      : normalizedUrl
  }

  async function resolveThumbnail() {
    const generation = ++loadGeneration
    channelThumbnail.value = null

    if (!enabled.value) {
      return
    }

    const resolvingChannelId = channelId.value
    const directThumbnail = getResultAuthorThumbnailUrl(result.value)
    const cachedChannel = getCachedChannelInfo(
      resolvingChannelId,
      store.getters.getSubscribedChannelsById
    )
    const cachedThumbnail = normalizeThumbnail(
      directThumbnail ?? cachedChannel?.thumbnail
    )

    if (cachedThumbnail !== null) {
      channelThumbnail.value = cachedThumbnail
      return
    }

    const resolvedChannel = await fetchChannelInfo(resolvingChannelId, {
      preference: store.getters.getBackendPreference,
      fallback: store.getters.getBackendFallback
    })

    if (
      generation === loadGeneration &&
      resolvingChannelId === channelId.value
    ) {
      channelThumbnail.value = normalizeThumbnail(resolvedChannel?.thumbnail)
    }
  }

  watch([result, channelId, enabled], resolveThumbnail, { immediate: true })

  onBeforeUnmount(() => {
    loadGeneration++
  })

  return { channelThumbnail }
}
