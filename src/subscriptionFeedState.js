// Refresh responses can have been prepared before a seen action completed.
// Preserve that action without replacing newer metadata or hiding new entries.
export function preserveSubscriptionSeenEntries(entries, previousEntries, idKey = 'videoId') {
  const seen = new Map((previousEntries ?? [])
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

export function subscriptionFeedField(tab) {
  const field = { videos: 'videos', shorts: 'shorts', live: 'liveStreams', posts: 'communityPosts' }[tab]
  if (!field) throw new Error('Invalid subscription feed')
  return field
}
