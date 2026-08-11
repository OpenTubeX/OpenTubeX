const LAST_USED_VERSION_STORAGE_KEY = 'opentubex.lastUsedVersion'

export function getLastUsedVersion() {
  try {
    return localStorage.getItem(LAST_USED_VERSION_STORAGE_KEY)
  } catch (error) {
    console.error('Failed to read the last used app version', error)
    return null
  }
}

export function setLastUsedVersion(version) {
  try {
    localStorage.setItem(LAST_USED_VERSION_STORAGE_KEY, version)
  } catch (error) {
    console.error('Failed to save the last used app version', error)
  }
}
