import { onBeforeUnmount, ref, watch } from 'vue'

import store from '../store/index'

import { youtubeImageUrlToInvidious } from '../helpers/api/invidious'
import { getLocalVideoChannels } from '../helpers/api/local'
import { fetchChannelInfo, getCachedChannelInfo } from '../helpers/channel-preferences'
import { getResultAuthorThumbnailUrl } from '../helpers/result-channel-avatar'
import { isCollaborativeVideoAuthor } from '../helpers/video-collaborators'

/**
 * Resolves the channel avatar for a video or playlist result.
 * @param {import('vue').Ref<object>} result
 * @param {import('vue').Ref<string | null>} channelId
 * @param {import('vue').ComputedRef<boolean>} enabled
 */
export function useResultChannelAvatar(result, channelId, enabled) {
  const channelThumbnail = ref(null)
  const channelThumbnails = ref([null])
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
    channelThumbnails.value = [null]

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

    channelThumbnail.value = cachedThumbnail
    channelThumbnails.value = [cachedThumbnail]

    if (result.value.hasCollaborators || result.value.collaborators?.length > 0 ||
      (resolvingChannelId == null && result.value.videoId &&
        (cachedThumbnail === null || isCollaborativeVideoAuthor(result.value.author)))) {
      try {
        const collaborators = result.value.collaborators?.length > 0
          ? result.value.collaborators
          : result.value.videoId ? await getLocalVideoChannels(result.value.videoId) : []
        if (generation !== loadGeneration) return
        if (collaborators.length > 0) {
          channelThumbnails.value = collaborators.map((channel, index) =>
            normalizeThumbnail(channel.thumbnail) ?? (index === 0 ? cachedThumbnail : null)
          )
          channelThumbnail.value = channelThumbnails.value[0]
          return
        }
      } catch {
        // Keep the available avatar when collaborator information is unavailable.
        return
      }
    }

    if (cachedThumbnail !== null) {
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
      channelThumbnails.value = [channelThumbnail.value]
    }
  }

  watch([result, channelId, enabled], resolveThumbnail, { immediate: true })

  onBeforeUnmount(() => {
    loadGeneration++
  })

  return { channelThumbnail, channelThumbnails }
}
