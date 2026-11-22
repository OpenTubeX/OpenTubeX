// @ts-check
import { profileDatastorePrefix } from '../../datastores/profileDatastoreNames.js'
import { parseSyncDeletionListKey, syncDeletionListKey } from './sync-deletions.js'

/**
 * Collections a separate profile keeps for itself. The server stores them as
 * `<collection>.<scope key>`, while sync merges them under these names.
 */
export const SCOPED_SYNC_COLLECTIONS = new Set([
  'history', 'playlists', 'subscriptions', 'watchStats', 'playlistBookmarks', 'seenVideos', 'seenPosts',
])

// The deletion lists of those collections, by the collection part of their key.
const SCOPED_DELETION_COLLECTIONS = new Set(['history', 'playlists', 'playlistVideos', 'subscriptions', 'playlistBookmarks'])

/**
 * Whether a server keeps every collection of a separate profile. Servers that
 * report 1 lack its saved playlists and seen videos and posts.
 * @param {Record<string, unknown> | null | undefined} capabilities
 */
export function supportsSeparateProfiles(capabilities) {
  return Number(capabilities?.separate_profiles) >= 2
}

/**
 * The scope part of a separate profile's server collection names, or null for
 * the shared data.
 * @param {string | null} profileId
 */
export function syncScopeKey(profileId) {
  return profileId === null ? null : profileDatastorePrefix(profileId).slice('profile-'.length)
}

/**
 * The server name of a collection in a data scope.
 * @param {string} collection
 * @param {string | null} scopeKey
 */
export function scopedSyncCollection(collection, scopeKey) {
  return scopeKey !== null && SCOPED_SYNC_COLLECTIONS.has(collection) ? `${collection}.${scopeKey}` : collection
}

/**
 * Whether a deletion list belongs to a data scope rather than to the data
 * every profile shares.
 * @param {string} key A {@link import('./sync-deletions.js').syncDeletionKey}
 */
export function isScopedSyncDeletionKey(key) {
  return SCOPED_DELETION_COLLECTIONS.has(key.split(':')[0])
}

/**
 * Adds the separate profile to the keys of its lists' deletion marks. Devices
 * share the marks of every profile in one collection, so they apply each mark
 * only to the lists of the profile that made it.
 * @template {{ key: string }} T
 * @param {T[]} marks Marks by {@link import('./sync-deletions.js').syncDeletionKey}
 * @param {string | null} dataScope The separate profile the sync merges, or null for the shared data
 * @returns {T[]} Marks by {@link syncDeletionListKey}
 */
export function toSharedSyncDeletionMarks(marks, dataScope) {
  if (dataScope === null) return marks
  return marks.map(mark => isScopedSyncDeletionKey(mark.key) ? { ...mark, key: syncDeletionListKey(mark.key, dataScope) } : mark)
}

/**
 * The shared deletion marks of the lists a sync merges, see {@link toSharedSyncDeletionMarks}.
 * @template {{ key: string }} T
 * @param {T[]} marks Marks by {@link syncDeletionListKey}
 * @param {string | null} dataScope The separate profile the sync merges, or null for the shared data
 * @returns {T[]} Marks by {@link import('./sync-deletions.js').syncDeletionKey}
 */
export function fromSharedSyncDeletionMarks(marks, dataScope) {
  return marks.flatMap(mark => {
    const parsed = parseSyncDeletionListKey(mark.key)
    if (!parsed) return []
    const [scope, key] = parsed
    // A list the profiles share takes no marks of a separate profile's lists.
    if (scope !== (isScopedSyncDeletionKey(key) ? dataScope : null)) return []
    return [{ ...mark, key }]
  })
}

/**
 * The sync baselines a sync in a data scope merges against: the shared ones,
 * with the scoped collections of that scope. Separate profiles keep theirs
 * under `scopes`.
 * @param {Record<string, any>} snapshot
 * @param {string | null} scopeKey
 * @returns {Record<string, any>}
 */
export function readScopedSnapshot(snapshot, scopeKey) {
  if (scopeKey === null) return snapshot
  const view = { ...snapshot }
  const scoped = snapshot.scopes?.[scopeKey] ?? {}
  for (const collection of SCOPED_SYNC_COLLECTIONS) {
    if (Object.hasOwn(scoped, collection)) view[collection] = scoped[collection]
    else delete view[collection]
  }
  return view
}

/**
 * Stores the baselines of a sync in a data scope, keeping the scoped baselines
 * of `saved` that the sync did not merge.
 * @param {Record<string, any>} saved The snapshot the sync read
 * @param {Record<string, any>} view The sync's baselines, see {@link readScopedSnapshot}
 * @param {string | null} scopeKey
 * @returns {Record<string, any>}
 */
export function writeScopedSnapshot(saved, view, scopeKey) {
  if (scopeKey === null) return view
  const stored = { ...view }
  /** @type {Record<string, any>} */
  const scoped = {}
  for (const collection of SCOPED_SYNC_COLLECTIONS) {
    if (Object.hasOwn(view, collection)) scoped[collection] = view[collection]
    if (Object.hasOwn(saved, collection)) stored[collection] = saved[collection]
    else delete stored[collection]
  }
  const scopes = { ...saved.scopes }
  if (Object.keys(scoped).length > 0) scopes[scopeKey] = scoped
  else delete scopes[scopeKey]
  if (Object.keys(scopes).length > 0) stored.scopes = scopes
  else delete stored.scopes
  return stored
}

/** @type {Promise<unknown> | null} */
let loading = null

/**
 * Records the load of the data a profile switch shows, during which the store
 * still holds the previous profile's data.
 * @template T
 * @param {Promise<T>} load
 * @returns {Promise<T>}
 */
export function trackDataScopeLoad(load) {
  const tracked = load.finally(() => {
    if (loading === tracked) loading = null
  })
  loading = tracked
  return tracked
}

/** The load of a profile switch's data, or null when the store shows the active profile's data */
export function dataScopeLoading() {
  return loading
}
