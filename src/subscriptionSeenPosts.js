import { mergeSeenMarks, parseSeenMarks } from './seenMarks.js'

export const MAX_SUBSCRIPTION_SEEN_POSTS = 10000

/** @type {import('./seenMarks.js').SeenMarkKind<{ postId: string, seenAt: number }>} */
export const SEEN_POST_MARKS = {
  idKey: 'postId',
  max: MAX_SUBSCRIPTION_SEEN_POSTS,
  parse: entries => entries.filter(entry => (
    typeof entry?.postId === 'string' && entry.postId.length > 0 &&
    Number.isFinite(entry.seenAt) && entry.seenAt > 0
  )),
  merge: (previous, entry) => ({ postId: entry.postId, seenAt: Math.max(previous?.seenAt ?? 0, entry.seenAt) }),
  latest: entry => entry.seenAt,
}

export function parseSubscriptionSeenPosts(value) {
  return parseSeenMarks(SEEN_POST_MARKS, value)
}

export function mergeSubscriptionSeenPosts(local, remote) {
  return mergeSeenMarks(SEEN_POST_MARKS, local, remote)
}
