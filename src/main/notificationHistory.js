// @ts-check
import { readFile, rename, writeFile } from 'node:fs/promises'

import {
  addNotificationHistoryEntries,
  applyNotificationDismissals,
  areNotificationDismissalsEqual,
  getDismissedNotificationEntries,
  markNotificationHistoryRead,
  mergeNotificationDismissals,
  normalizeNotificationDismissals,
  normalizeNotificationHistory,
  recordNotificationDismissals,
  removeNotificationHistoryEntry
} from '../notificationHistory.js'

/**
 * @typedef {import('../notificationHistory.js').NotificationHistoryEntry} NotificationHistoryEntry
 * @typedef {import('../notificationHistory.js').NotificationDismissals} NotificationDismissals
 * @typedef {{ entries: NotificationHistoryEntry[], dismissals: NotificationDismissals }} NotificationHistoryState
 */

/**
 * @param {string} file
 * @param {string} label
 */
function readJson(file, label) {
  return readFile(file, 'utf8')
    .then(text => JSON.parse(text))
    .catch(error => {
      if (error.code !== 'ENOENT') console.error(`Failed to read the ${label}`, error)
      return null
    })
}

/**
 * @param {string} file
 * @param {unknown} value
 */
async function writeJson(file, value) {
  await writeFile(file + '.tmp', JSON.stringify(value), { mode: 0o600 })
  await rename(file + '.tmp', file)
}

/**
 * Keeps the past system notifications for the in-app notification list. It
 * records them even when the system cannot show them, and keeps what was read
 * or removed for other devices.
 * @param {{
 *   file: string,
 *   dismissalsFile: string,
 *   onChange: (entries: NotificationHistoryEntry[]) => void,
 *   onDismissalsChange?: () => void,
 *   onStale?: (entries: NotificationHistoryEntry[]) => void
 * }} options `onDismissalsChange` reports dismissals made here, and `onStale`
 * the unread entries that were read or removed, whose system notifications are outdated.
 */
export function createNotificationHistory({ file, dismissalsFile, onChange, onDismissalsChange, onStale }) {
  /** @type {NotificationHistoryState | null} */
  let state = null
  let pending = Promise.resolve()
  /** @type {Promise<void> | null} */
  let loaded = null

  // Every caller shares the first read, so a slow one cannot replace newer entries.
  function load() {
    loaded ??= Promise.all([readJson(file, 'notification history'), readJson(dismissalsFile, 'notification dismissals')])
      .then(([entries, dismissals]) => {
        state = { entries: normalizeNotificationHistory(entries), dismissals: normalizeNotificationDismissals(dismissals) }
      })
    return loaded.then(() => /** @type {NotificationHistoryState} */ (state))
  }

  /**
   * @param {(state: NotificationHistoryState) => NotificationHistoryState & { since?: NotificationHistoryEntry[] }} update returns
   * the same arrays and objects for unchanged parts, and with `since` the entries to find dismissed ones among
   * @param {boolean} [local] whether the change dismisses notifications here
   */
  function change(update, local = false) {
    const result = pending.then(async () => {
      const current = await load()
      const { since = current.entries, ...next } = update(current)
      const entriesChanged = next.entries !== current.entries
      const dismissalsChanged = next.dismissals !== current.dismissals
      if (!entriesChanged && !dismissalsChanged) return
      state = next
      if (entriesChanged) {
        onChange(next.entries)
        const stale = getDismissedNotificationEntries(since, next.entries)
        if (stale.length > 0) onStale?.(stale)
      }
      if (local && dismissalsChanged) onDismissalsChange?.()
      if (entriesChanged) await writeJson(file, next.entries)
      if (dismissalsChanged) await writeJson(dismissalsFile, next.dismissals)
    })
    pending = result.catch(error => console.error('Failed to save the notification history', error))
    return pending
  }

  return {
    list: () => pending.then(load).then(current => current.entries),
    /**
     * @param {import('../notificationHistory.js').NotificationHistoryInput & { createdAt?: number }} entry
     * @returns {Promise<NotificationHistoryEntry | null | undefined>} the saved entry, already read when
     * another device read it, null when another device removed it, or undefined when it could not be saved
     */
    add: entry => {
      /** @type {NotificationHistoryEntry | null | undefined} */
      let added
      return change(current => {
        const withEntry = addNotificationHistoryEntries(current.entries, [entry])
        const created = withEntry.find(item => !current.entries.includes(item))
        if (!created) return current
        const entries = applyNotificationDismissals(withEntry, current.dismissals)
        added = entries.find(item => item.id === created.id) ?? null
        // Entries that made room for the new one were not dismissed.
        return added ? { ...current, entries, since: withEntry } : current
      }).then(() => added)
    },
    /** @param {string} [id] Omit to mark every entry read. */
    markRead: id => change(current => {
      const entries = markNotificationHistoryRead(current.entries, id)
      const read = current.entries.filter(entry => !entry.read && (id === undefined || entry.id === id))
      return {
        entries,
        dismissals: recordNotificationDismissals(current.dismissals, read, { removed: false, through: id === undefined })
      }
    }, true),
    /** @param {string} id */
    remove: id => change(current => ({
      entries: removeNotificationHistoryEntry(current.entries, id),
      dismissals: recordNotificationDismissals(current.dismissals, current.entries.filter(entry => entry.id === id), { removed: true })
    }), true),
    clear: () => change(current => current.entries.length === 0
      ? current
      : { entries: [], dismissals: recordNotificationDismissals(current.dismissals, current.entries, { removed: true, through: true }) }, true),
    getDismissals: () => pending.then(load).then(current => current.dismissals),
    /**
     * Adds the dismissals of other devices and applies them.
     * @param {unknown} remote
     * @returns {Promise<NotificationDismissals>} the combined dismissals
     */
    mergeDismissals: remote => change(current => {
      const merged = mergeNotificationDismissals(current.dismissals, normalizeNotificationDismissals(remote))
      const dismissals = areNotificationDismissalsEqual(merged, current.dismissals) ? current.dismissals : merged
      return { entries: applyNotificationDismissals(current.entries, dismissals), dismissals }
    }).then(load).then(current => current.dismissals)
  }
}

/**
 * @typedef {{ on: (event: string, listener: (details?: { reason?: string }) => void) => unknown, once: (event: string, listener: () => void) => unknown, close: () => void }} LinkedNotification
 */

/**
 * Keeps system notifications in step with their entries: opening or
 * dismissing one marks its entry read, and reading or removing the entry closes it.
 * @param {(id: string) => unknown} markRead
 * @param {NodeJS.Platform} [platform]
 */
export function createSystemNotificationLinks(markRead, platform = process.platform) {
  /** @type {Map<string, LinkedNotification>} */
  const links = new Map()
  return {
    /**
     * @param {NotificationHistoryEntry} entry
     * @param {LinkedNotification} notification
     */
    link(entry, notification) {
      links.set(entry.id, notification)
      notification.once('click', () => {
        links.delete(entry.id)
        markRead(entry.id)
      })
      notification.on('close', details => {
        // Windows also reports notifications that time out into the action
        // center, where closing them still removes them. macOS only reports
        // dismissals, while Linux also reports expired ones without a reason.
        const dismissed = details?.reason ? details.reason === 'userCanceled' : platform === 'darwin'
        if (!dismissed || links.get(entry.id) !== notification) return
        links.delete(entry.id)
        markRead(entry.id)
      })
    },
    /** @param {NotificationHistoryEntry[]} entries */
    close(entries) {
      for (const { id } of entries) {
        const notification = links.get(id)
        links.delete(id)
        notification?.close()
      }
    }
  }
}

/**
 * @typedef {'both' | 'system' | 'off'} NotificationMode
 */

/**
 * Decides how each notification reaches the user. With both, a focused app
 * window shows it in the app instead of the system, and the bell keeps it.
 * Notifications other devices dismissed stay silent.
 * @template Window
 * @template {LinkedNotification} SystemNotification
 * @param {{
 *   history: Pick<ReturnType<typeof createNotificationHistory>, 'add' | 'list'>,
 *   getMode: () => NotificationMode,
 *   getForegroundWindow: () => Window | null,
 *   showInApp: (window: Window, entry: NotificationHistoryEntry) => void,
 *   link?: (entry: NotificationHistoryEntry, notification: SystemNotification) => void
 * }} options
 */
export function createNotifier({ history, getMode, getForegroundWindow, showInApp, link }) {
  /**
   * @param {{ title: string, body: string, thumbnail?: string, createdAt?: number, target: import('../notificationHistory.js').NotificationHistoryTarget | null, showSystemNotification: () => void | SystemNotification | Promise<void | SystemNotification> }} notification
   */
  return async function notify({ title, body, thumbnail, createdAt, target, showSystemNotification }) {
    const mode = getMode()
    if (mode === 'off') return
    /** @type {NotificationHistoryEntry | null | undefined} */
    let entry
    if (mode === 'both' && target) {
      entry = await history.add({ title, body, thumbnail, createdAt, ...target })
      if (entry === null || entry?.read) return
      // The mode may have changed while the entry was saved.
      const currentMode = getMode()
      if (currentMode === 'off') return
      const window = currentMode === 'both' && entry && getForegroundWindow()
      if (window && entry) {
        showInApp(window, entry)
        return
      }
    }
    const notification = await showSystemNotification()
    if (!entry || !notification || !link) return
    // The entry may have been read or removed while its thumbnail loaded.
    const current = (await history.list()).find(item => item.id === entry.id)
    if (current && !current.read) link(entry, notification)
    else notification.close()
  }
}
