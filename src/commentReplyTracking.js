// @ts-check

/** Comments are watched for replies this long after their last activity. */
export const COMMENT_REPLY_TRACKING_MS = 30 * 24 * 60 * 60 * 1000

/** Each check requests every watched thread, so only the newest are watched. */
export const COMMENT_REPLY_TRACKING_LIMIT = 50

/** Reply IDs kept per thread to recognize replies already announced. */
const SEEN_REPLY_LIMIT = 500

/** Characters of a comment kept to show it in the list of watched comments. */
export const COMMENT_TEXT_LIMIT = 500

/** An author's comments per thread whose hearts are checked, as each may need a request of its own. */
export const HEART_COMMENT_LIMIT = 10

const ID_PATTERN = /^[\w-]+$/
// Post IDs, like comment IDs, start with Ug and are longer than the 11
// characters of video IDs, which tells the pages that comments are on apart.
const POST_ID_PATTERN = /^Ug[\w-]{20,}$/

const HANDLE_CHARACTERS = String.raw`\p{L}\p{M}\p{N}_\-·`

/**
 * A watched comment, the account's or anyone else's. `commentId` is
 * `threadId` for a top-level comment and `threadId.replyId` for a reply.
 * `channelId` and `handle` belong to its author, and replies from `accountId`,
 * the signed-in channel when it was watched, are not announced.
 *
 * `postedAt` is when it was posted or last watched, and `activeAt` its last
 * activity: being watched, a new reply or heart, or being opened. Watching
 * ends 30 days after it. Comments watched before activity counted lack it.
 *
 * `comments` lists the author's comments watched in the thread, the watched
 * one first, then the newest others, and whether the video's creator hearted
 * each, which is announced for the account's own comments. A comment watched
 * without its heart lacks `hearted` until its first check, and entries watched
 * before hearts were checked lack the list, which then holds the watched comment.
 *
 * Comments on a post have the post's ID as `videoId` and its channel as
 * `postAuthorId`, which loading them needs.
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
 *   activeAt?: number,
 *   replyCount: number,
 *   seen: string[],
 *   comments?: WatchedComment[],
 *   text?: string,
 *   videoTitle?: string,
 *   postAuthorId?: string
 * }} TrackedCommentThread
 */

/**
 * @typedef {{ id: string, hearted?: boolean }} WatchedComment `id` is the full ID, `threadId.replyId` for a reply
 */

/**
 * @typedef {{ id: string, authorId: string, author: string, text: string }} CommentReply
 * @typedef {{ hearted: boolean, author: string, text: string }} CommentHeart `author` is the handle of the creator
 *   who hearted it, if known, and `text` the comment's
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
    (value.activeAt === undefined || Number.isFinite(value.activeAt)) &&
    Number.isInteger(value.replyCount) &&
    Array.isArray(value.seen) && value.seen.every(id => typeof id === 'string') &&
    (value.comments === undefined || (Array.isArray(value.comments) && value.comments.every(comment =>
      typeof comment?.id === 'string' && (comment.hearted === undefined || typeof comment.hearted === 'boolean')))) &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.videoTitle === undefined || typeof value.videoTitle === 'string') &&
    (value.postAuthorId === undefined || (typeof value.postAuthorId === 'string' && ID_PATTERN.test(value.postAuthorId)))
}

/**
 * When a watched comment was last active, which its watching follows.
 * @param {TrackedCommentThread} thread
 */
export function getLastActivity(thread) {
  return thread.activeAt ?? thread.postedAt
}

/**
 * Keeps the valid threads still watched, last active first.
 * @param {unknown} value
 * @param {number} [now]
 * @returns {TrackedCommentThread[]}
 */
export function normalizeTrackedCommentThreads(value, now = Date.now()) {
  return Array.isArray(value)
    ? value.filter(isTrackedCommentThread)
        .filter(thread => now - getLastActivity(thread) < COMMENT_REPLY_TRACKING_MS)
        .sort((left, right) => getLastActivity(right) - getLastActivity(left))
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
 * Watches a comment for replies, until 30 days pass without activity. Each
 * author's comments in a thread are watched together, from the earliest one,
 * which every later reply follows, or from their top-level comment, which
 * covers the whole thread. Watching another of them counts as activity.
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
 *   postAuthorId?: string,
 *   replyCount?: number,
 *   seen?: string[],
 *   hearted?: boolean
 * }} comment `replyCount` and `seen` describe the replies it already has, `hearted` whether it is hearted, if known
 * @param {number} [now]
 * @returns {TrackedCommentThread[]}
 */
export function trackComment(threads, comment, now = Date.now()) {
  const existing = threads.find(thread => isSameWatchedComment(thread, comment))
  const others = threads.filter(thread => thread !== existing)
  const { videoId, threadId, commentId, channelId, handle, accountId, text, videoTitle, postAuthorId } = comment
  /** @type {TrackedCommentThread} */
  const tracked = existing
    ? {
        ...existing,
        // The text stays the watched comment's. A top-level comment watches the
        // whole thread, starting from the replies it had when watched.
        ...(commentId === threadId && existing.commentId !== threadId
          ? { commentId, text, seen: [...new Set([...existing.seen, ...(comment.seen ?? [])])].slice(-SEEN_REPLY_LIMIT) }
          : {}),
        ...(accountId && !existing.accountId ? { accountId } : {}),
        videoTitle: videoTitle || existing.videoTitle,
        postedAt: now,
        activeAt: now
      }
    : {
        videoId,
        threadId,
        commentId,
        channelId,
        handle,
        accountId,
        postedAt: now,
        activeAt: now,
        replyCount: comment.replyCount ?? -1,
        seen: (comment.seen ?? []).slice(-SEEN_REPLY_LIMIT),
        text,
        videoTitle,
        ...(postAuthorId ? { postAuthorId } : {})
      }
  tracked.comments = addWatchedComment(existing ? getHeartComments(existing) : [], getWatchedCommentId(tracked),
    { id: getWatchedCommentId(comment), ...(comment.hearted === undefined ? {} : { hearted: comment.hearted }) })
  return normalizeTrackedCommentThreads([tracked, ...others], now)
}

/**
 * Adds a comment to an entry's comments, keeping a heart state already known,
 * so watching it again does not announce an old heart.
 * @param {WatchedComment[]} comments
 * @param {string} watchedId the full ID of the watched comment, which stays first
 * @param {WatchedComment} added
 * @returns {WatchedComment[]}
 */
function addWatchedComment(comments, watchedId, added) {
  const known = comments.find(comment => comment.id === added.id)
  const all = [...comments.filter(comment => comment !== known), known?.hearted === undefined ? added : { ...added, hearted: known.hearted }]
  const watched = all.find(comment => comment.id === watchedId) ?? { id: watchedId }
  return [watched, ...all.filter(comment => comment !== watched).slice(1 - HEART_COMMENT_LIMIT)]
}

/**
 * The author's comments watched in a thread, whose hearts are checked.
 * @param {TrackedCommentThread} thread
 * @returns {WatchedComment[]}
 */
export function getHeartComments(thread) {
  return thread.comments ?? [{ id: getWatchedCommentId(thread) }]
}

/**
 * Counts opening a thread as activity of the comments watched in it.
 * @param {TrackedCommentThread[]} threads
 * @param {string} videoId
 * @param {string} threadId
 * @param {number} [now]
 * @returns {TrackedCommentThread[] | null} null when none of them is watched
 */
export function markThreadOpened(threads, videoId, threadId, now = Date.now()) {
  if (!threads.some(thread => thread.videoId === videoId && thread.threadId === threadId)) return null
  return normalizeTrackedCommentThreads(threads.map(thread =>
    thread.videoId === videoId && thread.threadId === threadId ? { ...thread, activeAt: now } : thread), now)
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
 * @returns {{ added: CommentReply[], seen: string[], active: boolean }} the new replies, the replies seen
 *   so far, and whether any new reply counts as activity: one announced, or one of the account's that follows the comment
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
  const isOwn = (/** @type {CommentReply} */ reply) => (accountId !== '' && reply.authorId === accountId) ||
    (signedInId !== '' && reply.authorId === signedInId)
  const fresh = replies.filter((reply, index) => index >= start && !seen.has(reply.id))
  const added = fresh.filter(reply => !isOwn(reply) && (wholeThread || mention?.test(reply.text)))
  return {
    added,
    active: added.length > 0 || fresh.some(isOwn),
    seen: [...new Set([...thread.seen, ...replies.map(reply => reply.id)])].slice(-SEEN_REPLY_LIMIT)
  }
}

/**
 * Which of a watched entry's comments got a new creator heart, to announce
 * only for the account's own comments, and not on the first check of a
 * comment watched without its heart, as it may be old.
 * @param {TrackedCommentThread} thread
 * @param {Map<string, CommentHeart>} hearts by full comment ID, without the comments the responses lacked
 * @returns {{ announce: { id: string, heart: CommentHeart }[], active: boolean, comments: WatchedComment[] }}
 *   the hearts to announce, whether any is new and so counts as activity, also for others' comments, and the comments to save
 */
export function checkCommentHearts(thread, hearts) {
  const own = isOwnWatchedComment(thread)
  /** @type {{ id: string, heart: CommentHeart }[]} */
  const announce = []
  let active = false
  const comments = getHeartComments(thread).map(comment => {
    const heart = hearts.get(comment.id)
    if (!heart) return comment
    // Announced once, even if the heart is taken back and given again.
    if (comment.hearted === false && heart.hearted) {
      active = true
      if (own) announce.push({ id: comment.id, heart })
    }
    return { ...comment, hearted: !!comment.hearted || heart.hearted }
  })
  return { announce, active, comments }
}

/**
 * The comments whose hearts need a request that links each: the account's
 * own ones that the responses so far lacked, except the watched comment,
 * which the first request links. Hearts on others' comments are not announced.
 * @param {TrackedCommentThread} thread
 * @param {Map<string, CommentHeart>} hearts by full comment ID, as found so far
 * @returns {WatchedComment[]}
 */
export function findCommentsToLink(thread, hearts) {
  const watchedId = getWatchedCommentId(thread)
  return isOwnWatchedComment(thread)
    ? getHeartComments(thread).filter(comment => comment.id !== watchedId && !hearts.has(comment.id))
    : []
}

/**
 * The full ID of the watched comment, `threadId.replyId` for a reply.
 * @param {Pick<TrackedCommentThread, 'threadId' | 'commentId'>} thread
 */
export function getWatchedCommentId({ threadId, commentId }) {
  // Posted replies may lack the `threadId.` that loaded ones start with.
  return commentId === threadId || commentId.startsWith(`${threadId}.`) ? commentId : `${threadId}.${commentId}`
}

/**
 * Reads whether a comment is hearted from a comments response that includes
 * it, as one that links the comment does, also when it is a reply, and as
 * reply pages do for their replies.
 * @param {any} response a YouTube comments response, as JSON
 * @param {string} commentId the full ID, `threadId.replyId` for a reply
 * @returns {CommentHeart | null} null without the comment
 */
export function findCommentHeart(response, commentId) {
  const mutations = response?.frameworkUpdates?.entityBatchUpdate?.mutations
  if (!Array.isArray(mutations)) return null
  const comment = mutations.find(mutation => mutation?.payload?.commentEntityPayload?.properties?.commentId === commentId)
    ?.payload.commentEntityPayload
  const stateKey = comment?.properties.toolbarStateKey
  const state = stateKey && mutations.find(mutation => mutation?.payload?.engagementToolbarStateEntityPayload?.key === stateKey)
    ?.payload.engagementToolbarStateEntityPayload
  if (!state) return null
  // The tooltip reads like "❤ by @handle", in the language of the response.
  const tooltip = typeof comment.toolbar?.heartActiveTooltip === 'string' ? comment.toolbar.heartActiveTooltip : ''
  const text = typeof comment.properties.content?.content === 'string' ? comment.properties.content.content : ''
  return {
    hearted: state.heartState === 'TOOLBAR_HEART_STATE_HEARTED',
    author: tooltip.match(new RegExp(`@[${HANDLE_CHARACTERS}.]*[${HANDLE_CHARACTERS}]`, 'u'))?.[0] ?? '',
    text: cleanCommentText(text)
  }
}

/**
 * A comment's text without the extra spaces, zero-width spaces, and
 * bidirectional isolates that come around mentions.
 * @param {string} text
 */
export function cleanCommentText(text) {
  return text.replaceAll(/[\u200B-\u200D\u2066-\u2069]/g, '').replaceAll(/\s+/g, ' ').trim()
}

/**
 * The page a comment is on: the video's, or the post's.
 * @param {string} id the video's or the post's ID
 */
function getCommentPagePath(id) {
  return POST_ID_PATTERN.test(id) ? `/post/${id}` : `/watch/${id}`
}

/**
 * The comment's link on YouTube.
 * @param {string} id the video's or the post's ID
 * @param {string} commentId
 */
export function getCommentWebUrl(id, commentId) {
  const url = POST_ID_PATTERN.test(id)
    ? new URL(`https://www.youtube.com/post/${encodeURIComponent(id)}`)
    : new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`)
  url.searchParams.set('lc', commentId)
  return url.toString()
}

/**
 * Where a reply or heart notification leads: the video or post, with the
 * reply or the hearted comment highlighted.
 * @param {unknown} kind `comment-reply` or `comment-heart`
 * @param {unknown} videoId the video's or the post's ID
 * @param {unknown} commentId a reply's ID is `threadId.replyId`
 * @returns {import('./notificationHistory.js').NotificationHistoryTarget | null}
 */
export function getCommentNotificationTarget(kind, videoId, commentId) {
  const [threadId, ...rest] = typeof commentId === 'string' ? commentId.split('.') : []
  if ((kind !== 'comment-reply' && kind !== 'comment-heart') || typeof videoId !== 'string' || !ID_PATTERN.test(videoId) ||
    !threadId || !ID_PATTERN.test(threadId) || rest.length > 1 || (rest.length === 0 && kind === 'comment-reply') ||
    !rest.every(id => ID_PATTERN.test(id))) return null
  return { kind, path: getCommentPagePath(videoId), query: { commentId: /** @type {string} */ (commentId) } }
}

/**
 * Where an entry in the list of watched comments leads: the video or post,
 * with the watched comment highlighted.
 * @param {TrackedCommentThread} thread
 */
export function getWatchedCommentTarget(thread) {
  return {
    path: getCommentPagePath(thread.videoId),
    query: { ...(thread.postAuthorId ? { authorId: thread.postAuthorId } : {}), commentId: getWatchedCommentId(thread) }
  }
}

/**
 * Whether a watched comment is on a post rather than a video.
 * @param {Pick<TrackedCommentThread, 'postAuthorId'>} thread
 */
export function isPostWatchedComment(thread) {
  return thread.postAuthorId !== undefined
}
