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
 * Profile IDs come from other devices through sync, while the apps only accept
 * lowercase letters, digits and hyphens in database names. Hex keeps every ID
 * distinct and every name valid.
 * @param {string} profileId
 */
export function profileDatastorePrefix(profileId) {
  if (typeof profileId !== 'string' || profileId.length === 0 || profileId.length > 64) {
    throw new TypeError('Invalid profile ID')
  }
  const hex = Array.from(new TextEncoder().encode(profileId), byte => byte.toString(16).padStart(2, '0')).join('')
  return `profile-${hex}`
}
