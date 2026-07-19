/**
 * TabSessionStore - Persists tab session data for restore on restart.
 *
 * Each BrowserWindow owns its own session record keyed by a stable
 * per-window session id, so that launching with multiple windows open
 * (e.g. Ctrl+Q on a multi-window session) restores every window.
 */
import * as baseHandlers from '../../datastores/handlers/base.js'

/**
 * @typedef {object} TabSessionBounds
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {boolean} [maximized]
 * @property {boolean} [fullScreen]
 */

/**
 * @typedef {object} TabSessionData
 * @property {Array<{id: string, url: string, title: string, isPinned?: boolean, color?: string | null, previewFileName?: string | null, previewCapturedAt?: number, history?: object[], historyIndex?: number}>} tabs
 * @property {string} activeTabId
 * @property {TabSessionBounds} [bounds]
 */

/**
 * @typedef {TabSessionData & { sessionId: string }} PersistedTabSession
 */

/**
 * Load all persisted tab sessions (one per window).
 * @returns {Promise<PersistedTabSession[]>}
 */
export async function loadAllTabSessions() {
  try {
    return await baseHandlers.tabSession.loadAll()
  } catch (err) {
    console.error('Failed to load tab sessions:', err)
  }
  return []
}

/**
 * Save a single window's tab session to the tab session datastore.
 * @param {string} sessionId
 * @param {TabSessionData} sessionData
 * @returns {Promise<void>}
 */
export async function saveTabSession(sessionId, sessionData) {
  try {
    await baseHandlers.tabSession.save(sessionId, sessionData)
  } catch (err) {
    console.error('Failed to save tab session:', err)
  }
}

/**
 * Clear a single window's saved tab session.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function clearTabSession(sessionId) {
  try {
    await baseHandlers.tabSession.clear(sessionId)
  } catch (err) {
    console.error('Failed to clear tab session:', err)
  }
}

/**
 * Clear all saved tab sessions.
 * @returns {Promise<void>}
 */
export async function clearAllTabSessions() {
  try {
    await baseHandlers.tabSession.clearAll()
  } catch (err) {
    console.error('Failed to clear all tab sessions:', err)
  }
}
