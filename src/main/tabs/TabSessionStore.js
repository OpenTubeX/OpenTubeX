/**
 * TabSessionStore - Persists tab session data for restore on restart
 */
import * as baseHandlers from '../../datastores/handlers/base.js'

const TAB_SESSION_KEY = 'tabSession'

/**
 * @typedef {object} TabSessionData
 * @property {Array<{id: string, url: string, title: string}>} tabs
 * @property {string} activeTabId
 */

/**
 * Load the saved tab session from the settings datastore
 * @returns {Promise<TabSessionData|null>}
 */
export async function loadTabSession() {
  try {
    const doc = await baseHandlers.settings._findOne(TAB_SESSION_KEY)
    if (doc && doc.value) {
      return doc.value
    }
  } catch (err) {
    console.error('Failed to load tab session:', err)
  }
  return null
}

/**
 * Save the tab session to the settings datastore
 * @param {TabSessionData} sessionData
 * @returns {Promise<void>}
 */
export async function saveTabSession(sessionData) {
  try {
    await baseHandlers.settings.upsert(TAB_SESSION_KEY, sessionData)
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
    await baseHandlers.settings.upsert(TAB_SESSION_KEY, null)
  } catch (err) {
    console.error('Failed to clear tab session:', err)
  }
}
