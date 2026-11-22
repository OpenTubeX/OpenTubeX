import { profileDatastorePrefix } from './datastores/profileDatastoreNames.js'

// A cached entry's `isNewInSubscriptionFeed` is its state in the feeds of the
// profiles that share their data. Separate profiles see the entry as new when
// it arrived as new (`arrivedNewInSubscriptionFeed`), unless they saw it, which
// `separateProfileFeedStates` records by their key. Their feeds show their own
// state as `isNewInSubscriptionFeed`, and keep the shared one in
// `sharedNewInSubscriptionFeed` and the profile in `subscriptionFeedScope`,
// see `feedEntryInScope`.

/** @param {string} scope A separate profile's ID */
function feedStateKey(scope) {
  return profileDatastorePrefix(scope)
}

/**
 * Whether a cached entry is new in the feeds of a data scope.
 * @param {Record<string, any> | null | undefined} entry
 * @param {string | null} scope A separate profile's ID, or null for the shared data
 */
export function isNewInFeedScope(entry, scope) {
  if (scope === null) return entry?.isNewInSubscriptionFeed === true
  const states = entry?.separateProfileFeedStates
  const key = feedStateKey(scope)
  const own = states && Object.hasOwn(states, key) ? states[key] : undefined
  // Entries cached before separate profiles only have the shared state.
  return (own ?? entry?.arrivedNewInSubscriptionFeed ?? entry?.isNewInSubscriptionFeed) === true
}

/**
 * A cached entry as the feeds of a data scope show it.
 * @template {Record<string, any>} T
 * @param {T} entry
 * @param {string | null} scope
 * @returns {T}
 */
export function feedEntryInScope(entry, scope) {
  if (scope === null) return entry
  const isNew = isNewInFeedScope(entry, scope)
  return {
    ...entry,
    isNewInSubscriptionFeed: isNew,
    sharedNewInSubscriptionFeed: entry.isNewInSubscriptionFeed === true,
    subscriptionFeedScope: scope,
  }
}

/**
 * The entry to cache for an entry of a separate profile's feeds, see
 * {@link feedEntryInScope}. Other entries, such as newly fetched ones, are
 * cached as they are.
 * @template {Record<string, any>} T
 * @param {T} entry
 * @returns {T}
 */
export function toCachedFeedEntry(entry) {
  const scope = entry?.subscriptionFeedScope
  if (typeof scope !== 'string') return entry
  const { sharedNewInSubscriptionFeed, separateProfileFeedStates, subscriptionFeedScope: _scope, ...cached } = entry
  const states = { ...separateProfileFeedStates }
  const key = feedStateKey(scope)
  // An entry that the profile sees as it arrived needs no state of its own.
  if (entry.isNewInSubscriptionFeed === ((cached.arrivedNewInSubscriptionFeed ?? sharedNewInSubscriptionFeed) === true)) {
    delete states[key]
  } else {
    states[key] = entry.isNewInSubscriptionFeed === true
  }
  return /** @type {T} */ ({
    ...cached,
    isNewInSubscriptionFeed: sharedNewInSubscriptionFeed === true,
    ...(Object.keys(states).length > 0 ? { separateProfileFeedStates: states } : {}),
  })
}

/**
 * A mark that an entry was seen in the feeds of a data scope, see
 * {@link preserveSubscriptionSeenEntries}.
 * @param {Record<string, any>} fields The entry's ID and members-only state
 * @param {string | null} scope
 */
export function seenFeedEntryMark(fields, scope) {
  return scope === null
    ? { ...fields, isNewInSubscriptionFeed: false }
    : { ...fields, separateProfileFeedStates: { [feedStateKey(scope)]: false } }
}

/** @param {Record<string, any>} entry */
function hasSeenState(entry) {
  return entry?.isNewInSubscriptionFeed === false ||
    Object.values(entry?.separateProfileFeedStates ?? {}).includes(false)
}

// Refresh responses can have been prepared before a seen action completed.
// Preserve that action without replacing newer metadata or hiding new entries.
// It applies to the shared state and to each separate profile's.
export function preserveSubscriptionSeenEntries(entries, previousEntries, idKey = 'videoId') {
  if (!Array.isArray(entries)) return []
  const normalizedPreviousEntries = Array.isArray(previousEntries) ? previousEntries : []
  const seen = new Map(normalizedPreviousEntries
    .filter(entry => hasSeenState(entry) &&
      typeof entry[idKey] === 'string' && entry[idKey].length > 0)
    .map(entry => [entry[idKey], entry]))
  if (seen.size === 0) return entries
  let changed = false
  const merged = entries.map(entry => {
    const previous = seen.get(entry[idKey])
    if (!previous || (previous.isMembersOnly === true && entry.isMembersOnly === false)) return entry
    let result = entry
    if (previous.isNewInSubscriptionFeed === false && entry.isNewInSubscriptionFeed === true) {
      // Separate profiles still see an entry cached before they existed as new.
      result = { arrivedNewInSubscriptionFeed: true, ...result, isNewInSubscriptionFeed: false }
    }
    for (const [key, state] of Object.entries(previous.separateProfileFeedStates ?? {})) {
      const states = result.separateProfileFeedStates
      const current = states && Object.hasOwn(states, key)
        ? states[key]
        : result.arrivedNewInSubscriptionFeed ?? result.isNewInSubscriptionFeed
      if (state !== false || current !== true) continue
      result = { ...result, separateProfileFeedStates: { ...states, [key]: false } }
    }
    if (result !== entry) changed = true
    return result
  })
  return changed ? merged : entries
}

/**
 * The uploads of `entries` with the collaborations of `storedEntries`. A
 * channel's collaborations are found by their own check, so a videos write
 * that does not store a check keeps the stored ones, even when another window
 * stored them after this write was prepared. Their state, such as a premiere
 * that went live, comes from the write when it lists them too.
 * @param {object[]} entries
 * @param {object[] | undefined} storedEntries
 */
export function keepStoredSubscriptionCollaborations(entries, storedEntries) {
  const collaborations = Array.isArray(storedEntries) ? storedEntries.filter(entry => entry?.isCollaboration === true) : []
  if (collaborations.length === 0 && !entries.some(entry => entry?.isCollaboration === true)) return entries
  const uploads = entries.filter(entry => entry?.isCollaboration !== true)
  const uploadIds = new Set(uploads.map(entry => entry.videoId))
  const written = new Map(entries.filter(entry => entry?.isCollaboration === true).map(entry => [entry.videoId, entry]))
  return uploads.concat(collaborations
    .filter(entry => !uploadIds.has(entry.videoId))
    .map(entry => written.get(entry.videoId) ?? entry))
}

/**
 * Whether a write stores the collaborations of a check made before the
 * stored one, which another window wrote first.
 * @param {number | null | undefined} checkedAt
 * @param {number | null | undefined} storedCheckedAt
 */
export function isOlderCollaborationCheck(checkedAt, storedCheckedAt) {
  return typeof checkedAt === 'number' && typeof storedCheckedAt === 'number' && checkedAt < storedCheckedAt
}

export function subscriptionFeedField(tab) {
  const field = { videos: 'videos', shorts: 'shorts', live: 'liveStreams', posts: 'communityPosts' }[tab]
  if (!field) throw new Error('Invalid subscription feed')
  return field
}
