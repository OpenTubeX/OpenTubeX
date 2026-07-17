const CHANNEL_THUMBNAIL_CACHE_KEY = 'channelThumbnailCache'

// Cap the persisted cache so it can't grow without bound across sessions. The
// cache is only a best-effort tab preview fallback, so an approximate FIFO
// eviction of the oldest entries is good enough.
export const CHANNEL_THUMBNAIL_CACHE_LIMIT = 200

/**
 * @returns {Record<string, string>}
 */
export function loadChannelThumbnailCache() {
  try {
    const raw = localStorage.getItem(CHANNEL_THUMBNAIL_CACHE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * @param {Record<string, string>} cache
 */
export function persistChannelThumbnailCache(cache) {
  try {
    localStorage.setItem(CHANNEL_THUMBNAIL_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore quota/serialization errors — the cache is a best-effort fallback.
  }
}
