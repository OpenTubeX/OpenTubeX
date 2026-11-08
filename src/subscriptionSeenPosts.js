export const MAX_SUBSCRIPTION_SEEN_POSTS = 10000

export function parseSubscriptionSeenPosts(value) {
  try {
    const entries = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(entries)) return []
    return entries.filter(entry => (
      typeof entry?.postId === 'string' && entry.postId.length > 0 &&
      Number.isFinite(entry.seenAt) && entry.seenAt > 0
    ))
  } catch {
    return []
  }
}

export function mergeSubscriptionSeenPosts(local, remote) {
  const byId = new Map()
  for (const entry of [...parseSubscriptionSeenPosts(local), ...parseSubscriptionSeenPosts(remote)]) {
    byId.set(entry.postId, {
      postId: entry.postId,
      seenAt: Math.max(byId.get(entry.postId)?.seenAt ?? 0, entry.seenAt),
    })
  }
  const byPostId = (a, b) => a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0
  return [...byId.values()]
    .sort((a, b) => b.seenAt - a.seenAt || byPostId(a, b))
    .slice(0, MAX_SUBSCRIPTION_SEEN_POSTS)
    .sort(byPostId)
}
