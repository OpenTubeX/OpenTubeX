/**
 * TabSessionStore - Persists tab session data for restore on restart
 */
import * as baseHandlers from '../../datastores/handlers/base.js'

/**
 * @typedef {object} TabSessionData
 * @property {Array<{id: string, url: string, title: string}>} tabs
 * @property {string} activeTabId
 */

/**
 * Load the saved tab session from the tab session datastore
 * @returns {Promise<TabSessionData|null>}
 */
export async function loadTabSession() {
  try {
    return await baseHandlers.tabSession.load()
  } catch (err) {
    console.error('Failed to load tab session:', err)
  }
  return null
}

/**
 * Save the tab session to the tab session datastore
 * @param {TabSessionData} sessionData
 * @returns {Promise<void>}
 */
export async function saveTabSession(sessionData) {
  try {
    await baseHandlers.tabSession.save(sessionData)
  } catch (err) {
    console.error('Failed to save tab session:', err)
  }
}

/**
 * Clear the saved tab session
 * @returns {Promise<void>}
 */
export async function clearTabSession() {
  try {
    await baseHandlers.tabSession.clear()
  } catch (err) {
    console.error('Failed to clear tab session:', err)
  }
}
