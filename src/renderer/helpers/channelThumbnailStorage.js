const CHANNEL_THUMBNAIL_CACHE_KEY = 'channelThumbnailCache'
const VIDEO_AVATAR_CACHE_KEY = 'videoAvatarCache'

// Cap the persisted cache so it can't grow without bound across sessions. The
// cache is only a best-effort tab preview fallback, so an approximate FIFO
// eviction of the oldest entries is good enough.
export const CHANNEL_THUMBNAIL_CACHE_LIMIT = 200
export const VIDEO_AVATAR_CACHE_LIMIT = 200

function loadThumbnailCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * @returns {Record<string, string>}
 */
export function loadChannelThumbnailCache() {
  return loadThumbnailCache(CHANNEL_THUMBNAIL_CACHE_KEY)
}

export function loadVideoAvatarCache() {
  return loadThumbnailCache(VIDEO_AVATAR_CACHE_KEY)
}

/**
 * @param {Record<string, string>} cache
 */
export function persistChannelThumbnailCache(cache) {
  persistThumbnailCache(CHANNEL_THUMBNAIL_CACHE_KEY, cache)
}

export function persistVideoAvatarCache(cache) {
  persistThumbnailCache(VIDEO_AVATAR_CACHE_KEY, cache)
}

function persistThumbnailCache(key, cache) {
  try {
    localStorage.setItem(key, JSON.stringify(cache))
  } catch {
    // Ignore quota/serialization errors — the cache is a best-effort fallback.
  }
}
