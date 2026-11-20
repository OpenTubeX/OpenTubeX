// Refresh responses can have been prepared before a seen action completed.
// Preserve that action without replacing newer metadata or hiding new entries.
export function preserveSubscriptionSeenEntries(entries, previousEntries, idKey = 'videoId') {
  if (!Array.isArray(entries)) return []
  const normalizedPreviousEntries = Array.isArray(previousEntries) ? previousEntries : []
  const seen = new Map(normalizedPreviousEntries
    .filter(entry => entry?.isNewInSubscriptionFeed === false &&
      typeof entry[idKey] === 'string' && entry[idKey].length > 0)
    .map(entry => [entry[idKey], entry]))
  if (seen.size === 0) return entries
  let changed = false
  const merged = entries.map(entry => {
    const previous = seen.get(entry[idKey])
    if (!previous || entry.isNewInSubscriptionFeed !== true ||
        (previous.isMembersOnly === true && entry.isMembersOnly === false)) return entry
    changed = true
    return { ...entry, isNewInSubscriptionFeed: false }
  })
  return changed ? merged : entries
}

/**
 * The uploads of `entries` with the collaborations of `storedEntries`. A
 * channel's collaborations are stored by their own check, so a videos write
 * that does not store them keeps the stored ones, even when another window
 * stored them after this write was prepared.
 * @param {object[]} entries
 * @param {object[] | undefined} storedEntries
 */
export function keepStoredSubscriptionCollaborations(entries, storedEntries) {
  const collaborations = Array.isArray(storedEntries) ? storedEntries.filter(entry => entry?.isCollaboration === true) : []
  if (collaborations.length === 0 && !entries.some(entry => entry?.isCollaboration === true)) return entries
  const uploads = entries.filter(entry => entry?.isCollaboration !== true)
  const uploadIds = new Set(uploads.map(entry => entry.videoId))
  return uploads.concat(collaborations.filter(entry => !uploadIds.has(entry.videoId)))
}

export function subscriptionFeedField(tab) {
  const field = { videos: 'videos', shorts: 'shorts', live: 'liveStreams', posts: 'communityPosts' }[tab]
  if (!field) throw new Error('Invalid subscription feed')
  return field
}
