import { addNotificationHistoryEntries, markNotificationHistoryRead, normalizeNotificationHistory } from '../../notificationHistory.js'

const STORAGE_KEY = 'opentubex-notification-history'
const listeners = new Set()

function read() {
  try {
    return normalizeNotificationHistory(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function write(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  for (const listener of listeners) listener(entries)
}

/** Keeps the past system notifications of the mobile apps. */
export const capacitorNotificationHistory = {
  async list() {
    return read()
  },

  /**
   * @param {(import('../../notificationHistory').NotificationHistoryInput & { createdAt?: number })[]} additions
   * @returns {import('../../notificationHistory').NotificationHistoryEntry[]} the added entries
   */
  add(additions) {
    if (additions.length === 0) return []
    const current = read()
    const next = addNotificationHistoryEntries(current, additions)
    write(next)
    return next.filter(entry => !current.includes(entry))
  },

  /** @param {string} [id] Omit to mark every entry read. */
  async markRead(id) {
    const entries = read()
    const marked = markNotificationHistoryRead(entries, id)
    if (marked !== entries) write(marked)
  },

  async clear() {
    write([])
  },

  onUpdated(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
