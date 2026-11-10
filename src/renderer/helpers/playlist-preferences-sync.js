import { areJsonValuesEqual } from './jsonValues.js'

// Stored in the existing encrypted settings collection; playlist records remain
// the local source of truth. Entries use the server's playlist IDs: the device
// that created a playlist on a legacy server, before encryption, keeps its own.
export const PLAYLIST_PREFERENCES_SYNC_KEY = 'playlistPreferences'
export const PLAYLIST_PREFERENCE_KEYS = ['addVideosToTop', 'shuffleByDefault', 'removeWatchedVideos']

/**
 * @param {Record<string, unknown>} [playlist]
 * @returns {Record<string, boolean>}
 */
export function normalizePlaylistPreferences(playlist) {
  return Object.fromEntries(PLAYLIST_PREFERENCE_KEYS.map(key => [key, playlist?.[key] === true]))
}

/**
 * Orders a local edit after the last one this playlist saw, even with clock skew.
 * @param {{ preferencesUpdatedAt?: number }} [playlist]
 */
export function getNextPlaylistPreferencesTimestamp(playlist) {
  const previous = playlist?.preferencesUpdatedAt
  return Number.isSafeInteger(previous) ? Math.max(Date.now(), previous + 1) : Date.now()
}

function getPlaylistPreferencesEntry(playlist) {
  const value = normalizePlaylistPreferences(playlist)
  // Untouched playlists use the defaults without needing a sync record.
  // Keep explicit resets so they can overwrite older choices elsewhere.
  if (playlist.preferencesUpdatedAt === undefined &&
      areJsonValuesEqual(value, normalizePlaylistPreferences())) return undefined
  return { value, updatedAt: playlist.preferencesUpdatedAt }
}

/**
 * @param {object[]} playlists
 * @param {Record<string, { remoteId?: string }>} playlistSnapshot the baselines of the last playlist sync
 */
export function getPlaylistPreferencesForSync(playlists, playlistSnapshot) {
  return Object.fromEntries(playlists.flatMap(playlist => {
    // Playlists that are not on the server yet sync their preferences once they are.
    const synced = playlistSnapshot[playlist._id]
    const entry = synced && getPlaylistPreferencesEntry(playlist)
    return entry ? [[synced.remoteId ?? playlist._id, entry]] : []
  }))
}

// `merged` holds the local preferences the merge used.
export async function applyPlaylistPreferencesSync(store, value, playlistSnapshot, merged) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return

  for (const [localId, synced] of Object.entries(playlistSnapshot)) {
    const remoteId = synced.remoteId ?? localId
    if (!Object.hasOwn(value, remoteId)) continue
    const updatedAt = value[remoteId]?.updatedAt
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      throw new Error('Invalid playlist preferences timestamp')
    }
    const playlist = store.state.playlists.playlists.find(item => item._id === localId)
    if (!playlist) continue
    const preferences = normalizePlaylistPreferences(value[remoteId].value)
    if (playlist.preferencesUpdatedAt === updatedAt &&
        areJsonValuesEqual(normalizePlaylistPreferences(playlist), preferences)) continue
    // An edit made after the merge read the preferences would be overwritten.
    if (!areJsonValuesEqual(getPlaylistPreferencesEntry(playlist), merged[remoteId])) {
      throw new Error('Playlist changed during sync. Try again.')
    }
    const saved = await store.dispatch('updatePlaylistFromSync', {
      previous: JSON.parse(JSON.stringify(playlist)),
      // Like sort order, these describe how to play the playlist, not its contents.
      keepLastUpdatedAt: true,
      playlist: { _id: localId, ...preferences, preferencesUpdatedAt: updatedAt },
    })
    if (!saved) throw new Error('Playlist changed during sync. Try again.')
  }
}
