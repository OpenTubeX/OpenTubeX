const CHANNEL_THUMBNAIL_CACHE_KEY = 'channelThumbnailCache'
const VIDEO_AVATAR_CACHE_KEY = 'videoAvatarCache'

function loadLegacyThumbnailCache(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function loadLegacyChannelThumbnailCache() {
  return loadLegacyThumbnailCache(CHANNEL_THUMBNAIL_CACHE_KEY)
}

export function loadLegacyVideoAvatarCache() {
  return loadLegacyThumbnailCache(VIDEO_AVATAR_CACHE_KEY)
}

export function removeLegacyTabAvatar(route) {
  const path = route?.path ?? ''
  const channelId = path.match(/^\/channel\/([^/]+)/)?.[1]
  const videoId = path.match(/^\/watch\/([^/]+)/)?.[1]
  if (channelId) removeLegacyThumbnail(CHANNEL_THUMBNAIL_CACHE_KEY, channelId)
  if (videoId) removeLegacyThumbnail(VIDEO_AVATAR_CACHE_KEY, videoId)
}

function removeLegacyThumbnail(key, id) {
  try {
    const cache = loadLegacyThumbnailCache(key)
    if (!(id in cache)) return

    delete cache[id]
    if (Object.keys(cache).length === 0) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(cache))
    }
  } catch {
    // Migration is best-effort; a later page load can populate the file cache.
  }
}
