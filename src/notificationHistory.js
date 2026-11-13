// @ts-check
import { parseTwitchNotificationId } from './twitchFollows.js'

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
  // Android announces Twitch streams like uploads
  if (feedType === 'twitch') return parseTwitchNotificationId(id)
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

/**
 * Read and removed notifications, shared with other devices by sync. Each
 * device creates its own entries, so dismissals match them by target. `at` is
 * when the item was last read or removed, and `removedAt` when it was last removed.
 * @typedef {{ key: string, at: number, removedAt?: number }} NotificationDismissal
 * @typedef {{ readThrough: number, clearedThrough: number, dismissals: NotificationDismissal[] }} NotificationDismissals
 */

/**
 * Each device keeps only its newest notifications, so a dismissal that much
 * older than the newest ones no longer matches any entry. Clearing a full
 * history alone records as many as the history holds.
 */
export const NOTIFICATION_DISMISSAL_LIMIT = 2 * NOTIFICATION_HISTORY_LIMIT

/**
 * The key of the item a notification is about, the same on every device.
 * Downloads describe work on one device and have none.
 * @param {NotificationHistoryTarget} target
 * @returns {string | null}
 */
export function getNotificationKey({ kind, path, query }) {
  if (kind.startsWith('download-')) return null
  const search = query ? new URLSearchParams(Object.entries(query).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)).toString() : ''
  return `${kind}:${path}${search ? `?${search}` : ''}`
}

/** @param {unknown} value */
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

/**
 * Keeps the valid dismissals, one per key, newest first, in an order every
 * device agrees on.
 * @param {any} value
 * @returns {NotificationDismissals}
 */
export function normalizeNotificationDismissals(value) {
  /** @type {Map<string, NotificationDismissal>} */
  const byKey = new Map()
  for (const dismissal of Array.isArray(value?.dismissals) ? value.dismissals : []) {
    if (typeof dismissal?.key !== 'string' || dismissal.key.length > 2048) continue
    const removedAt = Math.max(timestamp(dismissal.removedAt), byKey.get(dismissal.key)?.removedAt ?? 0)
    const at = Math.max(timestamp(dismissal.at), removedAt, byKey.get(dismissal.key)?.at ?? 0)
    if (!at) continue
    byKey.set(dismissal.key, { key: dismissal.key, at, ...(removedAt ? { removedAt } : {}) })
  }
  return {
    readThrough: timestamp(value?.readThrough),
    clearedThrough: timestamp(value?.clearedThrough),
    dismissals: [...byKey.values()]
      .sort((left, right) => right.at - left.at || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .slice(0, NOTIFICATION_DISMISSAL_LIMIT)
  }
}

/**
 * Combines dismissals from several devices. A removal outlasts a read of the
 * same notification.
 * @param {NotificationDismissals[]} values
 * @returns {NotificationDismissals}
 */
export function mergeNotificationDismissals(...values) {
  return normalizeNotificationDismissals({
    readThrough: Math.max(0, ...values.map(value => value.readThrough)),
    clearedThrough: Math.max(0, ...values.map(value => value.clearedThrough)),
    dismissals: values.flatMap(value => value.dismissals)
  })
}

/**
 * @param {NotificationDismissals} left
 * @param {NotificationDismissals} right
 */
export function areNotificationDismissalsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Records that entries were read or removed here, and with `through`, also
 * the ones other devices hold from before then.
 * Returns the same dismissals when nothing changes.
 * @param {NotificationDismissals} dismissals
 * @param {NotificationHistoryEntry[]} entries
 * @param {{ removed: boolean, through?: boolean, now?: number }} options
 * @returns {NotificationDismissals}
 */
export function recordNotificationDismissals(dismissals, entries, { removed, through = false, now = Date.now() }) {
  const added = entries.flatMap(entry => {
    const key = getNotificationKey(entry)
    return key ? [{ key, at: now, ...(removed ? { removedAt: now } : {}) }] : []
  })
  if (added.length === 0 && !through) return dismissals
  const next = mergeNotificationDismissals(dismissals, {
    readThrough: through && !removed ? now : 0,
    clearedThrough: through && removed ? now : 0,
    dismissals: added
  })
  return areNotificationDismissalsEqual(next, dismissals) ? dismissals : next
}

/**
 * Devices may show a reminder shortly before it is due, and their clocks
 * differ slightly, so dismissals from just before its start still apply.
 */
export const REMINDER_EARLY_MS = 60_000

/**
 * Marks entries read or removes them as dismissals say, including entries
 * this device adds after another one dismissed them. Returns the same array
 * when nothing changes.
 * @param {NotificationHistoryEntry[]} entries
 * @param {NotificationDismissals} dismissals
 * @returns {NotificationHistoryEntry[]}
 */
export function applyNotificationDismissals(entries, { readThrough, clearedThrough, dismissals }) {
  const byKey = new Map(dismissals.map(dismissal => [dismissal.key, dismissal]))
  let changed = false
  const next = entries.flatMap(entry => {
    const key = getNotificationKey(entry)
    if (!key) return [entry]
    const dismissal = byKey.get(key)
    // A reminder for a later premiere of the same video is a new notification,
    // so only what happened after it was due applies to it.
    const since = entry.kind === 'live-reminder' ? entry.createdAt - REMINDER_EARLY_MS : 0
    if ((dismissal?.removedAt ?? 0) >= Math.max(since, 1) || entry.createdAt <= clearedThrough) {
      changed = true
      return []
    }
    if (!entry.read && ((dismissal && dismissal.at >= since) || entry.createdAt <= readThrough)) {
      changed = true
      return [{ ...entry, read: true }]
    }
    return [entry]
  })
  return changed ? next : entries
}

/**
 * The entries that were unread and are now read or gone, whose system
 * notifications have become stale.
 * @param {NotificationHistoryEntry[]} previous
 * @param {NotificationHistoryEntry[]} next
 * @returns {NotificationHistoryEntry[]}
 */
export function getDismissedNotificationEntries(previous, next) {
  if (previous === next) return []
  const byId = new Map(next.map(entry => [entry.id, entry]))
  return previous.filter(entry => !entry.read && byId.get(entry.id)?.read !== false)
}
