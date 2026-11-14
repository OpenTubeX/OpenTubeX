// @ts-check

/** Comments are watched for replies this long after they were posted. */
export const COMMENT_REPLY_TRACKING_MS = 30 * 24 * 60 * 60 * 1000

/** Each check requests every watched thread, so only the newest are watched. */
export const COMMENT_REPLY_TRACKING_LIMIT = 50

/** Reply IDs kept per thread to recognize replies already announced. */
const SEEN_REPLY_LIMIT = 500

const ID_PATTERN = /^[\w-]+$/

const HANDLE_CHARACTERS = String.raw`\p{L}\p{M}\p{N}_\-·`

/**
 * A thread with a comment the account posted. `commentId` is the posted
 * comment, which is `threadId` for a top-level comment and `threadId.replyId`
 * for a reply.
 * @typedef {{
 *   videoId: string,
 *   threadId: string,
 *   commentId: string,
 *   channelId: string,
 *   handle: string | null,
 *   postedAt: number,
 *   replyCount: number,
 *   seen: string[]
 * }} TrackedCommentThread
 */

/**
 * @typedef {{ id: string, authorId: string, author: string, text: string }} CommentReply
 */

/**
 * @param {any} value
 * @returns {value is TrackedCommentThread}
 */
function isTrackedCommentThread(value) {
  return typeof value?.videoId === 'string' && ID_PATTERN.test(value.videoId) &&
    typeof value.threadId === 'string' && ID_PATTERN.test(value.threadId) &&
    typeof value.commentId === 'string' &&
    typeof value.channelId === 'string' &&
    (value.handle === null || typeof value.handle === 'string') &&
    Number.isFinite(value.postedAt) &&
    Number.isInteger(value.replyCount) &&
    Array.isArray(value.seen) && value.seen.every(id => typeof id === 'string')
}

/**
 * Keeps the valid threads still watched, newest first.
 * @param {unknown} value
 * @param {number} [now]
 * @returns {TrackedCommentThread[]}
 */
export function normalizeTrackedCommentThreads(value, now = Date.now()) {
  return Array.isArray(value)
    ? value.filter(isTrackedCommentThread)
        .filter(thread => now - thread.postedAt < COMMENT_REPLY_TRACKING_MS)
        .sort((left, right) => right.postedAt - left.postedAt)
        .slice(0, COMMENT_REPLY_TRACKING_LIMIT)
    : []
}

/**
 * Watches the thread of a comment the account posted. Posting in a watched
 * thread again keeps watching it from the earliest comment, which every
 * later reply follows, and for 30 days from the newest one.
 * @param {TrackedCommentThread[]} threads
 * @param {{ videoId: string, threadId: string, commentId: string, channelId: string, handle: string | null }} comment
 * @param {number} [now]
 * @returns {TrackedCommentThread[]}
 */
export function trackPostedComment(threads, { videoId, threadId, commentId, channelId, handle }, now = Date.now()) {
  const existing = threads.find(thread => thread.videoId === videoId && thread.threadId === threadId)
  const others = threads.filter(thread => thread !== existing)
  const tracked = existing
    ? { ...existing, postedAt: now }
    : { videoId, threadId, commentId, channelId, handle, postedAt: now, replyCount: -1, seen: [] }
  return normalizeTrackedCommentThreads([tracked, ...others], now)
}

/**
 * Replies to announce: in a thread the account started, every reply from
 * someone else, otherwise those that follow its comment and mention its handle,
 * which is how YouTube addresses replies to replies.
 * @param {TrackedCommentThread} thread
 * @param {CommentReply[]} replies the thread's replies in order, oldest first
 * @returns {{ added: CommentReply[], seen: string[] }} the new replies, and the replies seen so far
 */
export function findNewReplies(thread, replies) {
  const ownThread = thread.commentId === thread.threadId
  // Loaded replies are `threadId.replyId`, which a posted reply may lack.
  // Without the account's reply, as when it was deleted or not loaded, no
  // reply is known to follow it.
  const start = ownThread
    ? 0
    : replies.findIndex(reply => reply.id === thread.commentId || reply.id === `${thread.threadId}.${thread.commentId}`) + 1 || replies.length
  // The whole handle, which may end a sentence with a period. Handles can
  // contain letters of any script, digits, and `_-.·`.
  const mention = thread.handle
    ? new RegExp(`(?<![${HANDLE_CHARACTERS}.])${thread.handle.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![${HANDLE_CHARACTERS}]|\\.[${HANDLE_CHARACTERS}])`, 'iu')
    : null
  const seen = new Set(thread.seen)
  const added = replies.filter((reply, index) => index >= start &&
    !seen.has(reply.id) &&
    reply.authorId !== thread.channelId &&
    (ownThread || mention?.test(reply.text)))
  return {
    added,
    seen: [...new Set([...thread.seen, ...replies.map(reply => reply.id)])].slice(-SEEN_REPLY_LIMIT)
  }
}

/**
 * Where a reply notification leads: the video, with the reply highlighted.
 * @param {string} videoId
 * @param {string} replyId
 * @returns {import('./notificationHistory.js').NotificationHistoryTarget | null}
 */
export function getCommentReplyTarget(videoId, replyId) {
  const [threadId, ...rest] = typeof replyId === 'string' ? replyId.split('.') : []
  if (typeof videoId !== 'string' || !ID_PATTERN.test(videoId) || !threadId || !ID_PATTERN.test(threadId) ||
    rest.length !== 1 || !ID_PATTERN.test(rest[0])) return null
  return { kind: 'comment-reply', path: `/watch/${videoId}`, query: { commentId: replyId } }
}
