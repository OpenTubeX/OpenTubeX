import store from '../store/index'
import { getTabAvatarUrl } from '../tabs/tabPreview'
import { fetchTabAvatarBytes } from './tabAvatar'
import { mapConcurrently } from './concurrent-map'
import {
  getLocalChannel,
  getLocalVideoInfo,
  parseLocalChannelHeader
} from './api/local'
import {
  invidiousGetChannelInfo,
  invidiousGetVideoInformation,
  youtubeImageUrlToInvidious
} from './api/invidious'

const TAB_AVATAR_LOAD_CONCURRENCY = 4

function normalizeAvatarUrl(url) {
  return typeof url === 'string' && url.startsWith('//') ? `https:${url}` : url
}

async function resolveLocalAvatarUrl(path) {
  const channelId = path.match(/^\/channel\/([^/]+)/)?.[1]
  if (channelId) {
    const channel = await getLocalChannel(channelId)
    return normalizeAvatarUrl(parseLocalChannelHeader(channel, true).thumbnailUrl)
  }

  const videoId = path.match(/^\/watch\/([^/]+)/)?.[1]
  if (videoId) {
    const video = await getLocalVideoInfo(videoId)
    return normalizeAvatarUrl(video.info?.secondary_info?.owner?.author?.best_thumbnail?.url)
  }

  return null
}

async function resolveInvidiousAvatarUrl(path) {
  const instanceUrl = store.getters.getCurrentInvidiousInstanceUrl
  const channelId = path.match(/^\/channel\/([^/]+)/)?.[1]
  if (channelId) {
    const channel = await invidiousGetChannelInfo(channelId)
    const thumbnail = channel.authorThumbnails?.at(-1)?.url
    return thumbnail ? youtubeImageUrlToInvidious(thumbnail, instanceUrl) : null
  }

  const videoId = path.match(/^\/watch\/([^/]+)/)?.[1]
  if (videoId) {
    const video = await invidiousGetVideoInformation(videoId)
    const thumbnail = video.authorThumbnails?.at(-1)?.url
    return thumbnail ? youtubeImageUrlToInvidious(thumbnail, instanceUrl) : null
  }

  return null
}

async function fetchAvatarBytes(path, useLocalApi) {
  const avatarUrl = useLocalApi
    ? await resolveLocalAvatarUrl(path)
    : await resolveInvidiousAvatarUrl(path)
  return avatarUrl ? await fetchTabAvatarBytes(avatarUrl) : null
}

async function loadTabAvatar(tab) {
  const routePath = tab.route?.path
  if (typeof routePath !== 'string') return false

  const useLocalApi = store.getters.getBackendPreference === 'local'
  let avatarBytes
  try {
    avatarBytes = await fetchAvatarBytes(routePath, useLocalApi)
  } catch (error) {
    if (!store.getters.getBackendFallback) throw error
  }

  if (avatarBytes == null && store.getters.getBackendFallback) {
    avatarBytes = await fetchAvatarBytes(routePath, !useLocalApi)
  }
  if (avatarBytes == null) return false

  return await window.ftElectron.tabs.updateAvatar(
    avatarBytes,
    tab.id,
    routePath
  )
}

/**
 * Cache avatars for icon-less channel and watch tabs without activating them.
 * @param {Array<object>} tabs
 * @returns {Promise<{loaded: number, failed: number}>}
 */
export async function loadMissingTabAvatars(tabs) {
  const missingTabs = getMissingTabAvatarTabs(tabs)
  const results = await mapConcurrently(
    missingTabs,
    TAB_AVATAR_LOAD_CONCURRENCY,
    async tab => {
      try {
        return { status: 'fulfilled', value: await loadTabAvatar(tab) }
      } catch (reason) {
        return { status: 'rejected', reason }
      }
    }
  )

  return results.reduce((counts, result) => {
    if (result.status === 'fulfilled' && result.value) {
      counts.loaded++
    } else {
      counts.failed++
      if (result.status === 'rejected') {
        console.error('Failed to load a missing tab icon:', result.reason)
      }
    }
    return counts
  }, { loaded: 0, failed: 0 })
}

export function getMissingTabAvatarTabs(tabs) {
  return tabs.filter(tab => {
    return getTabAvatarUrl(tab) == null && /^\/(?:channel|watch)\//.test(tab.route?.path ?? '')
  })
}
