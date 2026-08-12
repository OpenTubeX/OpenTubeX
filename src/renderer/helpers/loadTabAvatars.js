import store from '../store/index'
import { getTabAvatarUrl } from '../tabs/tabPreview'
import { fetchTabAvatarBytes } from './tabAvatar'
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
    return normalizeAvatarUrl(video.secondary_info?.owner?.author?.best_thumbnail?.url)
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

async function resolveAvatarUrl(path) {
  const useLocalApi = store.getters.getBackendPreference === 'local'
  try {
    return useLocalApi
      ? await resolveLocalAvatarUrl(path)
      : await resolveInvidiousAvatarUrl(path)
  } catch (error) {
    if (!store.getters.getBackendFallback) throw error
    return useLocalApi
      ? await resolveInvidiousAvatarUrl(path)
      : await resolveLocalAvatarUrl(path)
  }
}

async function loadTabAvatar(tab) {
  const routePath = tab.route?.path
  if (typeof routePath !== 'string') return false

  const avatarUrl = await resolveAvatarUrl(routePath)
  if (!avatarUrl) return false

  const avatarBytes = await fetchTabAvatarBytes(avatarUrl)
  return avatarBytes != null && await window.ftElectron.tabs.updateAvatar(
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
  const missingTabs = tabs.filter(tab => {
    return getTabAvatarUrl(tab) == null && /^\/(?:channel|watch)\//.test(tab.route?.path ?? '')
  })
  const results = await Promise.allSettled(missingTabs.map(loadTabAvatar))

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
