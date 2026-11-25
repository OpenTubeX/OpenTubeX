import { getPlatform, getPlatformChannelKey } from '../../platforms/index.js'
import { isHistoryEntryWatched } from '../../history.js'

// Before media from other sites had history records, it saved only where it was left.
const LEGACY_POSITION_PREFIX = 'externalMediaPosition:'

/**
 * History keys media from other sites by its address, which never looks like a
 * YouTube video ID.
 * @param {unknown} url
 * @returns {string | null}
 */
export function getExternalMediaHistoryId(url) {
  try {
    const parsed = new URL(/** @type {string} */ (url))
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

/**
 * @param {unknown} videoId
 * @returns {videoId is string}
 */
export function isExternalMediaHistoryId(videoId) {
  return typeof videoId === 'string' && /^https?:\/\//.test(videoId)
}

/**
 * @param {unknown} url
 * @param {Record<string, object>} historyById
 */
export function isExternalMediaWatched(url, historyById) {
  const videoId = getExternalMediaHistoryId(url)
  return videoId !== null && isHistoryEntryWatched(historyById[videoId])
}

/**
 * As with YouTube subscription videos, an unseen mark from after the media was
 * last watched unmarks it as watched, while watching it again later still counts.
 * @param {{ getters: { getHistoryCacheById: Record<string, object> }, dispatch: (type: string, payload: object) => Promise<unknown> }} store
 * @param {unknown} url
 * @param {number} unseenAt
 */
export function unwatchExternalMediaMarkedUnseen(store, url, unseenAt) {
  const videoId = getExternalMediaHistoryId(url)
  const entry = videoId === null ? undefined : store.getters.getHistoryCacheById[videoId]
  if (!isHistoryEntryWatched(entry) || !(unseenAt > (entry.timeWatched ?? 0))) return
  store.dispatch('updateHistory', { ...entry, isWatched: false })
}

/**
 * The channel of an external history record, saved as its followable key, or
 * empty for sites without channel pages in the app.
 * @param {string | null | undefined} platform
 * @param {string | null | undefined} id
 */
export function getExternalMediaAuthorId(platform, id) {
  return platform && id && getPlatform(platform) ? getPlatformChannelKey({ platform, id }) : ''
}

/**
 * @param {unknown} authorId
 * @returns {{ platform: string, id: string } | null}
 */
export function parseExternalMediaAuthorId(authorId) {
  if (typeof authorId !== 'string') return null
  const separator = authorId.indexOf(':')
  const platform = authorId.slice(0, separator)
  const id = authorId.slice(separator + 1)
  return separator > 0 && id && getPlatform(platform) ? { platform, id } : null
}

function hostname(url) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * How lists show an external history record, in the shape of a feed item.
 * @param {object} record
 */
export function externalMediaHistoryItem(record) {
  const channel = parseExternalMediaAuthorId(record.authorId)
  return {
    url: record.videoId,
    title: record.title && record.title !== record.videoId ? record.title : hostname(record.videoId),
    author: record.author ?? '',
    platform: channel?.platform,
    channelId: channel?.id ?? '',
    thumbnail: record.thumbnail ?? '',
    published: Number.isFinite(record.published) && record.published > 0 ? record.published : null,
    duration: record.lengthSeconds,
    viewCount: record.viewCount ?? undefined,
    isLive: record.isLive === true,
  }
}

/**
 * Turns the positions saved before media from other sites had history records
 * into records, and removes them. Records the history already has win.
 * @param {Record<string, object>} historyById
 * @param {number | null} cutoff positions saved before this are dropped
 * @returns {{ records: object[], keys: string[] }}
 */
export function readLegacyExternalMediaPositions(historyById, cutoff) {
  const records = []
  const keys = []
  try {
    if (typeof localStorage === 'undefined') return { records, keys }
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith(LEGACY_POSITION_PREFIX)) continue
      keys.push(key)
      const videoId = getExternalMediaHistoryId(key.slice(LEGACY_POSITION_PREFIX.length))
      let position
      try {
        position = JSON.parse(localStorage.getItem(key) ?? 'null')
      } catch {
        continue
      }
      if (videoId === null || historyById[videoId] || !Number.isFinite(position?.seconds) || position.seconds < 0 ||
        !Number.isFinite(position.updatedAt) || (cutoff !== null && position.updatedAt < cutoff)) continue
      const lengthSeconds = Number.isFinite(position.duration) && position.duration > 0 ? position.duration : 0
      records.push({
        videoId,
        // Sync takes a title equal to the ID for a missing one, which a played copy fills.
        title: videoId,
        author: '',
        authorId: '',
        published: 0,
        description: '',
        lengthSeconds,
        watchProgress: position.seconds,
        isWatched: position.watched === true,
        timeWatched: position.updatedAt,
        isLive: false,
        isUpcoming: false,
        type: 'video',
      })
    }
  } catch (error) {
    console.error('Failed to read saved external media positions:', error)
  }
  return { records, keys }
}

/** @param {string[]} keys */
export function removeLegacyExternalMediaPositions(keys) {
  try {
    for (const key of keys) localStorage.removeItem(key)
  } catch (error) {
    console.error('Failed to remove saved external media positions:', error)
  }
}
