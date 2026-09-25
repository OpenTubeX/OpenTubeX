const ACTIVITY_MAX_CHANGES = 500
const ACTIVITY_MAX_ENTRIES = 200
const ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * @typedef {{ id: string, recipient?: unknown, expires_at?: unknown, payload?: unknown, created_at?: unknown }} SyncEvent
 * @typedef {{ id: string, createdAt: number, deviceName?: string, key?: string, collection?: string, [key: string]: unknown }} SyncActivityEntry
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @returns {value is SyncEvent} */
function isSyncEvent(value) {
  return isRecord(value) && typeof value.id === 'string'
}

/** @param {unknown} response @returns {SyncEvent[]} */
export function parseSyncEvents(response) {
  if (!Array.isArray(response)) throw new Error('Invalid sync events')
  return response.filter(isSyncEvent)
}

/** @param {string} cursor @param {SyncEvent} event @returns {string} */
export function getNextSyncEventCursor(cursor, event) {
  // Broadcast entries can advance the cursor even if expired or unreadable.
  // Device requests remain pending until acknowledged.
  return event.recipient === '' && event.id > cursor ? event.id : cursor
}

/**
 * @param {SyncActivityEntry[]} current
 * @param {SyncEvent} event
 * @param {unknown} payload
 * @returns {SyncActivityEntry[]}
 */
export function appendSyncActivityEntries(current, event, payload) {
  const activity = [...current]
  if (!isRecord(payload) || payload.version !== 1 || payload.type !== 'activity' ||
      !Array.isArray(payload.changes) || typeof payload.deviceName !== 'string' ||
      typeof event.created_at !== 'number') return activity

  const seen = new Set(activity.map(entry => entry.id))
  for (const [index, change] of payload.changes.slice(0, ACTIVITY_MAX_CHANGES).entries()) {
    if (!isRecord(change) || (typeof change.key !== 'string' && typeof change.collection !== 'string')) continue
    const id = `${event.id}:${index}`
    if (seen.has(id)) continue
    activity.push({ ...change, id, deviceName: payload.deviceName, createdAt: event.created_at })
    seen.add(id)
  }
  return activity
}

/** @param {SyncActivityEntry[]} activity @param {number} now @returns {SyncActivityEntry[]} */
export function pruneSyncActivity(activity, now = Date.now()) {
  return activity
    .filter(entry => entry.createdAt > now - ACTIVITY_RETENTION_MS)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(0, ACTIVITY_MAX_ENTRIES)
}
