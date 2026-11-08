// @ts-check

/** Older entries are dropped once the history holds this many. */
export const NOTIFICATION_HISTORY_LIMIT = 100

export const NOTIFICATION_HISTORY_KINDS = /** @type {const} */ ([
  'live-reminder',
  'live',
  'video',
  'short',
  'post',
  'download-started',
  'download-completed',
  'download-failed'
])

/**
 * @typedef {typeof NOTIFICATION_HISTORY_KINDS[number]} NotificationHistoryKind
 * @typedef {{ kind: NotificationHistoryKind, path: string, query?: Record<string, string> }} NotificationHistoryTarget
 * @typedef {NotificationHistoryTarget & { title: string, body: string, thumbnail?: string }} NotificationHistoryInput
 * @typedef {NotificationHistoryInput & { id: string, createdAt: number, read: boolean }} NotificationHistoryEntry
 */

const ID_PATTERN = /^[\w-]+$/

/**
 * Whether a value is a thumbnail URL the app may load: YouTube's, or one of the
 * configured Invidious instance, which can be a local server.
 * @param {unknown} url
 * @returns {url is string}
 */
export function isThumbnailUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return false
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * @param {unknown} query
 * @returns {query is Record<string, string> | undefined}
 */
function isQuery(query) {
  return query === undefined || (typeof query === 'object' && query !== null && !Array.isArray(query) &&
    Object.values(query).every(value => typeof value === 'string'))
}

/**
 * @param {any} entry
 * @returns {entry is NotificationHistoryEntry}
 */
export function isNotificationHistoryEntry(entry) {
  return typeof entry?.id === 'string' &&
    NOTIFICATION_HISTORY_KINDS.includes(entry.kind) &&
    typeof entry.title === 'string' &&
    typeof entry.body === 'string' &&
    typeof entry.path === 'string' && entry.path.startsWith('/') &&
    isQuery(entry.query) &&
    (entry.thumbnail === undefined || isThumbnailUrl(entry.thumbnail)) &&
    Number.isFinite(entry.createdAt) &&
    typeof entry.read === 'boolean'
}

/**
 * Keeps the valid entries of a saved history, newest first.
 * @param {unknown} value
 * @returns {NotificationHistoryEntry[]}
 */
export function normalizeNotificationHistory(value) {
  return Array.isArray(value)
    ? value.filter(isNotificationHistoryEntry)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, NOTIFICATION_HISTORY_LIMIT)
    : []
}

/**
 * @param {NotificationHistoryEntry[]} entries
 * @param {(NotificationHistoryInput & { createdAt?: number })[]} additions
 * @param {number} [now]
 * @returns {NotificationHistoryEntry[]}
 */
export function addNotificationHistoryEntries(entries, additions, now = Date.now()) {
  const added = additions.map(({ kind, title, body, path, query, thumbnail, createdAt = now }) => ({
    id: crypto.randomUUID(),
    kind,
    title,
    body,
    path,
    ...(query ? { query } : {}),
    ...(isThumbnailUrl(thumbnail) ? { thumbnail } : {}),
    createdAt,
    read: false
  }))
  return normalizeNotificationHistory([...added, ...entries])
}

/**
 * Marks one entry read, or all of them without an ID. Returns the same array
 * when nothing changes.
 * @param {NotificationHistoryEntry[]} entries
 * @param {string} [id]
 * @returns {NotificationHistoryEntry[]}
 */
export function markNotificationHistoryRead(entries, id) {
  const marked = entry => !entry.read && (id === undefined || entry.id === id)
  return entries.some(marked) ? entries.map(entry => marked(entry) ? { ...entry, read: true } : entry) : entries
}

/**
 * Removes one entry. Returns the same array when it is missing.
 * @param {NotificationHistoryEntry[]} entries
 * @param {string} id
 * @returns {NotificationHistoryEntry[]}
 */
export function removeNotificationHistoryEntry(entries, id) {
  return entries.some(entry => entry.id === id) ? entries.filter(entry => entry.id !== id) : entries
}

/**
 * @param {string} videoId
 * @returns {NotificationHistoryTarget}
 */
export function getLiveReminderTarget(videoId) {
  return { kind: 'live-reminder', path: `/watch/${videoId}` }
}

/**
 * Where an upload notification leads in the app. Ended streams in the live
 * feed are announced like videos.
 * @param {string} feedType
 * @param {unknown} id
 * @param {boolean} [live]
 * @returns {NotificationHistoryTarget | null}
 */
export function getUploadTarget(feedType, id, live = false) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
  if (feedType === 'posts') return { kind: 'post', path: `/post/${id}` }
  if (feedType === 'shorts') return { kind: 'short', path: `/watch/${id}`, query: { short: 'true' } }
  return { kind: live ? 'live' : 'video', path: `/watch/${id}` }
}

/**
 * @param {'started' | 'completed' | 'failed'} phase
 * @param {unknown} videoId
 * @param {number | null} downloadId
 * @returns {NotificationHistoryTarget}
 */
export function getAutomaticDownloadTarget(phase, videoId, downloadId) {
  return phase === 'completed' && typeof videoId === 'string' && ID_PATTERN.test(videoId) && Number.isInteger(downloadId)
    ? { kind: 'download-completed', path: `/watch/${videoId}`, query: { downloadId: String(downloadId) } }
    : { kind: phase === 'failed' ? 'download-failed' : 'download-started', path: '/downloads' }
}
