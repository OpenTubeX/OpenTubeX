// @ts-check

// The datastores each separate profile keeps for itself.
export const PROFILE_DATASTORES = {
  history: 'history',
  watchStats: 'watch-stats',
  recommendations: 'recommendations',
  playlists: 'playlists',
  searchHistory: 'search-history',
}

/**
 * Whether a profile ID can name a separate profile's datastores and sync
 * collections. Their names hold the ID's UTF-8 bytes as hex, which the sync
 * server and file systems limit.
 * @param {unknown} profileId
 */
export function isValidSeparateProfileId(profileId) {
  return typeof profileId === 'string' && profileId.length > 0 && profileId.length <= 64 &&
    new TextEncoder().encode(profileId).length <= 64
}

/**
 * Profile IDs come from other devices through sync, while the apps only accept
 * lowercase letters, digits and hyphens in database names. Hex keeps every ID
 * distinct and every name valid.
 * @param {string} profileId
 */
export function profileDatastorePrefix(profileId) {
  if (!isValidSeparateProfileId(profileId)) {
    throw new TypeError('Invalid profile ID')
  }
  const hex = Array.from(new TextEncoder().encode(profileId), byte => byte.toString(16).padStart(2, '0')).join('')
  return `profile-${hex}`
}
