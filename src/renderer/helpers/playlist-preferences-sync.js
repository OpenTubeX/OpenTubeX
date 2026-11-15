import { areJsonValuesEqual } from './jsonValues.js'

// Stored in the existing encrypted settings collection; playlist records remain
// the local source of truth. Entries use the server's playlist IDs: the device
// that created a playlist on a legacy server, before encryption, keeps its own.
export const PLAYLIST_PREFERENCES_SYNC_KEY = 'playlistPreferences'
// Released versions rewrite `playlistPreferences` entries without the fields
// they do not know, so later preferences sync under their own key and edit time.
export const PLAYLIST_WATCHED_THRESHOLD_SYNC_KEY = 'playlistWatchedThresholds'

/**
 * @param {unknown} value
 * @returns {number | null} null uses the global watched percentage threshold
 */
export function normalizeRemoveWatchedVideosThreshold(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null
}

const normalizeBoolean = value => value === true

/** @type {Record<string, { timestampKey: string, fields: Record<string, (value: unknown) => unknown> }>} */
const PREFERENCE_GROUPS = {
  [PLAYLIST_PREFERENCES_SYNC_KEY]: {
    timestampKey: 'preferencesUpdatedAt',
    fields: { addVideosToTop: normalizeBoolean, shuffleByDefault: normalizeBoolean, removeWatchedVideos: normalizeBoolean },
  },
  [PLAYLIST_WATCHED_THRESHOLD_SYNC_KEY]: {
    timestampKey: 'watchedThresholdUpdatedAt',
    fields: { removeWatchedVideosThreshold: normalizeRemoveWatchedVideosThreshold },
  },
}

export const PLAYLIST_PREFERENCES_SYNC_KEYS = Object.keys(PREFERENCE_GROUPS)
export const PLAYLIST_PREFERENCE_KEYS = PLAYLIST_PREFERENCES_SYNC_KEYS.flatMap(key => Object.keys(PREFERENCE_GROUPS[key].fields))
export const PLAYLIST_PREFERENCE_TIMESTAMP_KEYS = PLAYLIST_PREFERENCES_SYNC_KEYS.map(key => PREFERENCE_GROUPS[key].timestampKey)

/**
 * @param {Record<string, unknown>} [playlist]
 * @param {string} [syncKey] only the preferences of this sync key, otherwise all of them
 * @returns {Record<string, unknown>}
 */
export function normalizePlaylistPreferences(playlist, syncKey) {
  const groups = syncKey ? [PREFERENCE_GROUPS[syncKey]] : Object.values(PREFERENCE_GROUPS)
  return Object.fromEntries(groups.flatMap(group => (
    Object.entries(group.fields).map(([key, normalize]) => [key, normalize(playlist?.[key])])
  )))
}

/**
 * Orders a local edit after the last one this playlist saw, even with clock skew.
 * @param {Record<string, unknown>} [playlist]
 * @param {string} [syncKey]
 */
export function getNextPlaylistPreferencesTimestamp(playlist, syncKey = PLAYLIST_PREFERENCES_SYNC_KEY) {
  const previous = playlist?.[PREFERENCE_GROUPS[syncKey].timestampKey]
  return Number.isSafeInteger(previous) ? Math.max(Date.now(), previous + 1) : Date.now()
}

/**
 * Sets the edit time of each preference group that `changes` edits, so sync
 * merges them per playlist.
 * @param {Record<string, unknown>} changes the playlist update, edited in place
 * @param {Record<string, unknown>} [current] the playlist before the update, if any
 */
export function stampPlaylistPreferenceEdits(changes, current) {
  for (const [syncKey, group] of Object.entries(PREFERENCE_GROUPS)) {
    const edited = Object.entries(group.fields).some(([key, normalize]) => (
      Object.hasOwn(changes, key) && (!current || normalize(changes[key]) !== normalize(current[key]))
    ))
    if (edited) changes[group.timestampKey] = getNextPlaylistPreferencesTimestamp(current, syncKey)
  }
}

function getPlaylistPreferencesEntry(playlist, syncKey) {
  const { timestampKey } = PREFERENCE_GROUPS[syncKey]
  const value = normalizePlaylistPreferences(playlist, syncKey)
  // Untouched playlists use the defaults without needing a sync record.
  // Keep explicit resets so they can overwrite older choices elsewhere.
  if (playlist[timestampKey] === undefined &&
      areJsonValuesEqual(value, normalizePlaylistPreferences(undefined, syncKey))) return undefined
  return { value, updatedAt: playlist[timestampKey] }
}

/**
 * @param {object[]} playlists
 * @param {Record<string, { remoteId?: string }>} playlistSnapshot the baselines of the last playlist sync
 * @param {string} [syncKey]
 */
export function getPlaylistPreferencesForSync(playlists, playlistSnapshot, syncKey = PLAYLIST_PREFERENCES_SYNC_KEY) {
  return Object.fromEntries(playlists.flatMap(playlist => {
    // Playlists that are not on the server yet sync their preferences once they are.
    const synced = playlistSnapshot[playlist._id]
    const entry = synced && getPlaylistPreferencesEntry(playlist, syncKey)
    return entry ? [[synced.remoteId ?? playlist._id, entry]] : []
  }))
}

// `merged` holds the local preferences the merge used.
export async function applyPlaylistPreferencesSync(store, value, playlistSnapshot, merged, syncKey = PLAYLIST_PREFERENCES_SYNC_KEY) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return

  const { timestampKey } = PREFERENCE_GROUPS[syncKey]
  for (const [localId, synced] of Object.entries(playlistSnapshot)) {
    const remoteId = synced.remoteId ?? localId
    if (!Object.hasOwn(value, remoteId)) continue
    const updatedAt = value[remoteId]?.updatedAt
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      throw new Error('Invalid playlist preferences timestamp')
    }
    const playlist = store.state.playlists.playlists.find(item => item._id === localId)
    if (!playlist) continue
    const preferences = normalizePlaylistPreferences(value[remoteId].value, syncKey)
    if (playlist[timestampKey] === updatedAt &&
        areJsonValuesEqual(normalizePlaylistPreferences(playlist, syncKey), preferences)) continue
    // An edit made after the merge read the preferences would be overwritten.
    if (!areJsonValuesEqual(getPlaylistPreferencesEntry(playlist, syncKey), merged[remoteId])) {
      throw new Error('Playlist changed during sync. Try again.')
    }
    const saved = await store.dispatch('updatePlaylistFromSync', {
      previous: JSON.parse(JSON.stringify(playlist)),
      // Like sort order, these describe how to play the playlist, not its contents.
      keepLastUpdatedAt: true,
      playlist: { _id: localId, ...preferences, [timestampKey]: updatedAt },
    })
    if (!saved) throw new Error('Playlist changed during sync. Try again.')
  }
}
