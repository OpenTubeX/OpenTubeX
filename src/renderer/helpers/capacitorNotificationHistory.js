import {
  addNotificationHistoryEntries,
  applyNotificationDismissals,
  areNotificationDismissalsEqual,
  getDismissedNotificationEntries,
  getNotificationKey,
  markNotificationHistoryRead,
  mergeNotificationDismissals,
  normalizeNotificationDismissals,
  normalizeNotificationHistory,
  recordNotificationDismissals,
  removeNotificationHistoryEntry
} from '../../notificationHistory.js'
import { closeCapacitorSystemNotifications } from './capacitorSystemNotifications.js'

const STORAGE_KEY = 'opentubex-notification-history'
const DISMISSALS_STORAGE_KEY = 'opentubex-notification-dismissals'
const listeners = new Set()
const dismissalListeners = new Set()

function read() {
  try {
    return normalizeNotificationHistory(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function readDismissals() {
  try {
    return normalizeNotificationDismissals(JSON.parse(localStorage.getItem(DISMISSALS_STORAGE_KEY) ?? 'null'))
  } catch {
    return normalizeNotificationDismissals(null)
  }
}

/**
 * @param {import('../../notificationHistory').NotificationHistoryEntry[]} previous
 * @param {import('../../notificationHistory').NotificationHistoryEntry[]} entries
 */
function write(previous, entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  for (const listener of listeners) listener(entries)
  const stale = getDismissedNotificationEntries(previous, entries)
  if (stale.length > 0) closeCapacitorSystemNotifications(stale)
}

/**
 * Saves the entries and dismissals of a change made here.
 * @param {import('../../notificationHistory').NotificationHistoryEntry[]} previous
 * @param {import('../../notificationHistory').NotificationHistoryEntry[]} entries
 * @param {import('../../notificationHistory').NotificationDismissals} dismissals
 * @param {import('../../notificationHistory').NotificationDismissals} nextDismissals
 */
function dismiss(previous, entries, dismissals, nextDismissals) {
  if (nextDismissals !== dismissals) localStorage.setItem(DISMISSALS_STORAGE_KEY, JSON.stringify(nextDismissals))
  if (entries !== previous) write(previous, entries)
  if (nextDismissals !== dismissals) {
    for (const listener of dismissalListeners) listener()
  }
}

/** Keeps the past system notifications of the mobile apps, and what was read or removed for other devices. */
export const capacitorNotificationHistory = {
  async list() {
    return read()
  },

  /**
   * Notifications another device removed are left out, and ones it read are
   * added read. The system notifications of both close.
   * @param {(import('../../notificationHistory').NotificationHistoryInput & { createdAt?: number })[]} additions
   * @returns {import('../../notificationHistory').NotificationHistoryEntry[]} the added entries
   */
  add(additions) {
    if (additions.length === 0) return []
    const now = Date.now()
    const current = read()
    const next = applyNotificationDismissals(addNotificationHistoryEntries(current, additions, now), readDismissals())
    const added = next.filter(entry => !current.includes(entry))
    if (added.length > 0) write(current, next)
    const unread = new Set(added.filter(entry => !entry.read).map(entry => `${entry.path} ${entry.createdAt}`))
    const dismissed = additions.filter(addition => !unread.has(`${addition.path} ${addition.createdAt ?? now}`))
    if (dismissed.length > 0) closeCapacitorSystemNotifications(dismissed)
    return added
  },

  /**
   * Marks the entries about these targets read, for system notifications the
   * user opened or dismissed.
   * @param {import('../../notificationHistory').NotificationHistoryTarget[]} targets
   */
  markTargetsRead(targets) {
    const keys = new Set(targets.map(getNotificationKey))
    const entries = read()
    const newlyRead = entries.filter(entry => !entry.read && keys.has(getNotificationKey(entry)))
    if (newlyRead.length === 0) return
    const ids = new Set(newlyRead.map(entry => entry.id))
    const dismissals = readDismissals()
    dismiss(entries, entries.map(entry => ids.has(entry.id) ? { ...entry, read: true } : entry), dismissals,
      recordNotificationDismissals(dismissals, newlyRead, { removed: false }))
  },

  /** @param {string} [id] Omit to mark every entry read. */
  async markRead(id) {
    const entries = read()
    const dismissals = readDismissals()
    const newlyRead = entries.filter(entry => !entry.read && (id === undefined || entry.id === id))
    dismiss(entries, markNotificationHistoryRead(entries, id), dismissals,
      recordNotificationDismissals(dismissals, newlyRead, { removed: false, through: id === undefined }))
  },

  /** @param {string} id */
  async remove(id) {
    const entries = read()
    const dismissals = readDismissals()
    dismiss(entries, removeNotificationHistoryEntry(entries, id), dismissals,
      recordNotificationDismissals(dismissals, entries.filter(entry => entry.id === id), { removed: true }))
  },

  async clear() {
    const entries = read()
    if (entries.length === 0) return
    const dismissals = readDismissals()
    dismiss(entries, [], dismissals, recordNotificationDismissals(dismissals, entries, { removed: true, through: true }))
  },

  async getDismissals() {
    return readDismissals()
  },

  /**
   * Adds and applies the dismissals of other devices.
   * @param {unknown} remote
   * @returns {Promise<import('../../notificationHistory').NotificationDismissals>} the combined dismissals
   */
  async mergeDismissals(remote) {
    const current = readDismissals()
    const merged = mergeNotificationDismissals(current, normalizeNotificationDismissals(remote))
    if (!areNotificationDismissalsEqual(merged, current)) localStorage.setItem(DISMISSALS_STORAGE_KEY, JSON.stringify(merged))
    const entries = read()
    const next = applyNotificationDismissals(entries, merged)
    if (next !== entries) write(entries, next)
    return merged
  },

  onUpdated(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Reports notifications read or removed on this device, for other devices. */
  onDismissed(listener) {
    dismissalListeners.add(listener)
    return () => dismissalListeners.delete(listener)
  }
}
