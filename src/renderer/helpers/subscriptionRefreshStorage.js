/** @typedef {'videos' | 'shorts' | 'live' | 'posts'} SubscriptionRefreshTab */

/**
 * @param {object} dependencies
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} dependencies.storage
 * @param {() => Array<{ _id: string }>} dependencies.getProfiles
 * @param {readonly SubscriptionRefreshTab[]} dependencies.tabs
 * @param {string} dependencies.legacyPrefix
 * @param {string} dependencies.deadlinePrefix
 * @param {string} dependencies.completionPrefix
 */
export function createSubscriptionRefreshStorage({
  storage, getProfiles, tabs, legacyPrefix, deadlinePrefix, completionPrefix,
}) {
  /**
   * @param {string} prefix
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getSubscriptionAutoRefreshStorageKey(prefix, profileId, tab) {
    return `${prefix}${encodeURIComponent(profileId)}/${tab}`
  }

  /**
   * @param {string} key
   */
  function getStoredSubscriptionAutoRefreshTimestamp(key) {
    try {
      const timestamp = Number(storage.getItem(key))
      return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
    } catch {
      return null
    }
  }

  /**
   * @param {string} key
   * @param {number | null} timestamp
   */
  function setStoredSubscriptionAutoRefreshTimestamp(key, timestamp) {
    try {
      if (timestamp === null) {
        storage.removeItem(key)
      } else {
        storage.setItem(key, String(timestamp))
      }
    } catch {
      // Auto refresh still works for the current session when storage is unavailable.
    }
  }

  /**
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab) {
    const key = getSubscriptionAutoRefreshStorageKey(
      deadlinePrefix,
      profileId,
      tab
    )
    const timestamp = getStoredSubscriptionAutoRefreshTimestamp(key)
    return timestamp
  }

  function migrateLegacySubscriptionAutoRefreshDeadlines() {
    for (const tab of tabs) {
      const legacyKey = `${legacyPrefix}${tab}`
      const legacyTimestamp = getStoredSubscriptionAutoRefreshTimestamp(legacyKey)
      if (legacyTimestamp === null) {
        continue
      }

      for (const profile of getProfiles()) {
        const profileKey = getSubscriptionAutoRefreshStorageKey(
          deadlinePrefix,
          profile._id,
          tab
        )
        if (getStoredSubscriptionAutoRefreshTimestamp(profileKey) === null) {
          setStoredSubscriptionAutoRefreshTimestamp(profileKey, legacyTimestamp)
        }
      }

      setStoredSubscriptionAutoRefreshTimestamp(legacyKey, null)
    }
  }

  /**
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {number | null} timestamp
   */
  function setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp) {
    setStoredSubscriptionAutoRefreshTimestamp(
      getSubscriptionAutoRefreshStorageKey(
        deadlinePrefix,
        profileId,
        tab
      ),
      timestamp
    )
  }

  /**
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab) {
    return getStoredSubscriptionAutoRefreshTimestamp(
      getSubscriptionAutoRefreshStorageKey(
        completionPrefix,
        profileId,
        tab
      )
    )
  }

  /**
   * @param {string | null} key
   * @param {string} prefix
   * @returns {{profileId: string, tab: 'videos' | 'shorts' | 'live' | 'posts'} | null}
   */
  function parseSubscriptionAutoRefreshStorageKey(key, prefix) {
    if (!key?.startsWith(prefix)) {
      return null
    }

    const separatorIndex = key.lastIndexOf('/')
    const tab = key.slice(separatorIndex + 1)
    if (separatorIndex < prefix.length || !tabs.includes(tab)) {
      return null
    }

    try {
      return {
        profileId: decodeURIComponent(key.slice(prefix.length, separatorIndex)),
        tab
      }
    } catch {
      return null
    }
  }

  return {
    getSubscriptionAutoRefreshStorageKey,
    setStoredSubscriptionAutoRefreshTimestamp,
    getStoredSubscriptionTabNextAutoRefreshTimestamp,
    migrateLegacySubscriptionAutoRefreshDeadlines,
    setStoredSubscriptionTabNextAutoRefreshTimestamp,
    getStoredSubscriptionTabLastRefreshTimestamp,
    parseSubscriptionAutoRefreshStorageKey,
  }
}
