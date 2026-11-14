// @ts-check

/** Comments are watched for replies this long after they were posted or watched. */
export const COMMENT_REPLY_TRACKING_MS = 30 * 24 * 60 * 60 * 1000

/** Each check requests every watched thread, so only the newest are watched. */
export const COMMENT_REPLY_TRACKING_LIMIT = 50

/** Reply IDs kept per thread to recognize replies already announced. */
const SEEN_REPLY_LIMIT = 500

/** Characters of a comment kept to show it in the list of watched comments. */
export const COMMENT_TEXT_LIMIT = 500

const ID_PATTERN = /^[\w-]+$/

const HANDLE_CHARACTERS = String.raw`\p{L}\p{M}\p{N}_\-·`

/**
 * A watched comment, the account's or anyone else's. `commentId` is
 * `threadId` for a top-level comment and `threadId.replyId` for a reply.
 * `channelId` and `handle` belong to its author, and replies from `accountId`,
 * the signed-in channel when it was watched, are not announced.
 *
 * Comments watched before others' comments could be watched are the account's
 * own and lack `accountId`, which is `channelId` then. Those watched before
 * the list of watched comments existed also lack `text` and `videoTitle`.
 * @typedef {{
 *   videoId: string,
 *   threadId: string,
 *   commentId: string,
 *   channelId: string,
 *   handle: string | null,
 *   accountId?: string,
 *   postedAt: number,
 *   replyCount: number,
 *   seen: string[],
 *   text?: string,
 *   videoTitle?: string
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
    (value.accountId === undefined || typeof value.accountId === 'string') &&
    Number.isFinite(value.postedAt) &&
    Number.isInteger(value.replyCount) &&
    Array.isArray(value.seen) && value.seen.every(id => typeof id === 'string') &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.videoTitle === undefined || typeof value.videoTitle === 'string')
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
 * Whether a watched comment is the account's own.
 * @param {TrackedCommentThread} thread
 */
export function isOwnWatchedComment(thread) {
  const accountId = thread.accountId ?? thread.channelId
  return accountId !== '' && accountId === thread.channelId
}

/**
 * Whether two entries watch the same author's comments in the same thread.
 * @param {Pick<TrackedCommentThread, 'videoId' | 'threadId' | 'channelId'>} left
 * @param {Pick<TrackedCommentThread, 'videoId' | 'threadId' | 'channelId'>} right
 */
export function isSameWatchedComment(left, right) {
  return left.videoId === right.videoId && left.threadId === right.threadId && left.channelId === right.channelId
}

/**
 * Watches a comment for replies, for 30 days. Each author's comments in a
 * thread are watched together, from the earliest one, which every later reply
 * follows, or from their top-level comment, which covers the whole thread.
 * Watching another of them watches for 30 days from then.
 * @param {TrackedCommentThread[]} threads
 * @param {{
 *   videoId: string,
 *   threadId: string,
 *   commentId: string,
 *   channelId: string,
 *   handle: string | null,
 *   accountId: string,
 *   text: string,
 *   videoTitle: string,
 *   replyCount?: number,
 *   seen?: string[]
 * }} comment `replyCount` and `seen` describe the replies it already has
 * @param {number} [now]
 * @returns {TrackedCommentThread[]}
 */
export function trackComment(threads, comment, now = Date.now()) {
  const existing = threads.find(thread => isSameWatchedComment(thread, comment))
  const others = threads.filter(thread => thread !== existing)
  const { videoId, threadId, commentId, channelId, handle, accountId, text, videoTitle } = comment
  /** @type {TrackedCommentThread} */
  const tracked = existing
    ? {
        ...existing,
        // The text stays the watched comment's.
        ...(commentId === threadId ? { commentId, text } : {}),
        ...(accountId && !existing.accountId ? { accountId } : {}),
        videoTitle: videoTitle || existing.videoTitle,
        postedAt: now
      }
    : {
        videoId,
        threadId,
        commentId,
        channelId,
        handle,
        accountId,
        postedAt: now,
        replyCount: comment.replyCount ?? -1,
        seen: (comment.seen ?? []).slice(-SEEN_REPLY_LIMIT),
        text,
        videoTitle
      }
  return normalizeTrackedCommentThreads([tracked, ...others], now)
}

/**
 * Stops watching a comment, with its author's other comments in the thread.
 * @param {TrackedCommentThread[]} threads
 * @param {Pick<TrackedCommentThread, 'videoId' | 'threadId' | 'channelId'>} comment
 */
export function untrackComment(threads, comment) {
  return threads.filter(thread => !isSameWatchedComment(thread, comment))
}

/**
 * Replies to announce, except the account's own: for a top-level comment,
 * every reply in its thread, otherwise those that follow the comment and
 * mention its author's handle, which is how YouTube addresses replies to replies.
 * @param {TrackedCommentThread} thread
 * @param {CommentReply[]} replies the thread's replies in order, oldest first
 * @param {string} [signedInId] the channel signed in now, which may differ from the one it was watched with
 * @returns {{ added: CommentReply[], seen: string[] }} the new replies, and the replies seen so far
 */
export function findNewReplies(thread, replies, signedInId = '') {
  const wholeThread = thread.commentId === thread.threadId
  // Loaded replies are `threadId.replyId`, which a posted reply may lack.
  // Without the watched reply, as when it was deleted or not loaded, no
  // reply is known to follow it.
  const start = wholeThread
    ? 0
    : replies.findIndex(reply => reply.id === thread.commentId || reply.id === `${thread.threadId}.${thread.commentId}`) + 1 || replies.length
  // The whole handle, which may end a sentence with a period. Handles can
  // contain letters of any script, digits, and `_-.·`.
  const mention = thread.handle
    ? new RegExp(`(?<![${HANDLE_CHARACTERS}.])${thread.handle.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![${HANDLE_CHARACTERS}]|\\.[${HANDLE_CHARACTERS}])`, 'iu')
    : null
  const accountId = thread.accountId ?? thread.channelId
  const seen = new Set(thread.seen)
  const added = replies.filter((reply, index) => index >= start &&
    !seen.has(reply.id) &&
    (accountId === '' || reply.authorId !== accountId) &&
    (signedInId === '' || reply.authorId !== signedInId) &&
    (wholeThread || mention?.test(reply.text)))
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

/**
 * Where an entry in the list of watched comments leads: the video, with the
 * watched comment highlighted.
 * @param {TrackedCommentThread} thread
 */
export function getWatchedCommentTarget({ videoId, threadId, commentId }) {
  // Posted replies may lack the `threadId.` that loaded ones start with.
  const highlighted = commentId === threadId || commentId.startsWith(`${threadId}.`) ? commentId : `${threadId}.${commentId}`
  return { path: `/watch/${videoId}`, query: { commentId: highlighted } }
}
