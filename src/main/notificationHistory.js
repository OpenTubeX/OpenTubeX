// @ts-check
import { readFile, rename, writeFile } from 'node:fs/promises'

import { addNotificationHistoryEntries, markNotificationHistoryRead, normalizeNotificationHistory } from '../notificationHistory.js'

/**
 * Keeps the past system notifications for the in-app notification list. It
 * records them even when the system cannot show them.
 * @param {{ file: string, onChange: (entries: import('../notificationHistory.js').NotificationHistoryEntry[]) => void }} options
 */
export function createNotificationHistory({ file, onChange }) {
  /** @type {import('../notificationHistory.js').NotificationHistoryEntry[] | null} */
  let entries = null
  let pending = Promise.resolve()
  /** @type {Promise<void> | null} */
  let loaded = null

  // Every caller shares the first read, so a slow one cannot replace newer entries.
  function load() {
    loaded ??= readFile(file, 'utf8')
      .then(text => normalizeNotificationHistory(JSON.parse(text)))
      .catch(error => {
        if (error.code !== 'ENOENT') console.error('Failed to read the notification history', error)
        return []
      })
      .then(value => { entries = value })
    return loaded.then(() => /** @type {import('../notificationHistory.js').NotificationHistoryEntry[]} */ (entries))
  }

  /**
   * @param {(entries: import('../notificationHistory.js').NotificationHistoryEntry[]) => import('../notificationHistory.js').NotificationHistoryEntry[]} update
   */
  function change(update) {
    const result = pending.then(async () => {
      const next = update(await load())
      if (next === entries) return
      entries = next
      onChange(entries)
      await writeFile(file + '.tmp', JSON.stringify(entries), { mode: 0o600 })
      await rename(file + '.tmp', file)
    })
    pending = result.catch(error => console.error('Failed to save the notification history', error))
    return pending
  }

  return {
    list: () => pending.then(load),
    /**
     * @param {import('../notificationHistory.js').NotificationHistoryInput} entry
     * @returns {Promise<import('../notificationHistory.js').NotificationHistoryEntry | undefined>}
     */
    add: entry => {
      /** @type {import('../notificationHistory.js').NotificationHistoryEntry | undefined} */
      let added
      return change(current => {
        const next = addNotificationHistoryEntries(current, [entry])
        added = next.find(item => !current.includes(item))
        return next
      }).then(() => added)
    },
    /** @param {string} [id] Omit to mark every entry read. */
    markRead: id => change(current => markNotificationHistoryRead(current, id)),
    clear: () => change(current => current.length === 0 ? current : [])
  }
}

/**
 * @typedef {'both' | 'system' | 'off'} NotificationMode
 */

/**
 * Decides how each notification reaches the user. With both, a focused app
 * window shows it in the app instead of the system, and the bell keeps it.
 * @template Window
 * @param {{
 *   history: { add: ReturnType<typeof createNotificationHistory>['add'] },
 *   getMode: () => NotificationMode,
 *   getForegroundWindow: () => Window | null,
 *   showInApp: (window: Window, entry: import('../notificationHistory.js').NotificationHistoryEntry) => void
 * }} options
 */
export function createNotifier({ history, getMode, getForegroundWindow, showInApp }) {
  /**
   * @param {{ title: string, body: string, thumbnail?: string, target: import('../notificationHistory.js').NotificationHistoryTarget | null, showSystemNotification: () => void | Promise<void> }} notification
   */
  return async function notify({ title, body, thumbnail, target, showSystemNotification }) {
    const mode = getMode()
    if (mode === 'off') return
    if (mode === 'both' && target) {
      const entry = await history.add({ title, body, thumbnail, ...target })
      // The mode may have changed while the entry was saved.
      const currentMode = getMode()
      if (currentMode === 'off') return
      const window = currentMode === 'both' && entry && getForegroundWindow()
      if (window) {
        showInApp(window, entry)
        return
      }
    }
    await showSystemNotification()
  }
}
