/**
 * @param {number} parsedReplyCount
 * @param {number} loadedReplyCount
 * @param {number} expectedReplyCount
 * @param {boolean} hasNextContinuation
 */
export function getReplyLoadState(parsedReplyCount, loadedReplyCount, expectedReplyCount, hasNextContinuation) {
  const hasMissingReplies = parsedReplyCount === 0 &&
    loadedReplyCount < expectedReplyCount &&
    !hasNextContinuation

  return {
    hasMore: hasNextContinuation,
    hasMissingReplies,
    showReplies: loadedReplyCount > 0,
  }
}

/**
 * @param {boolean} hasLoadedBatch
 * @param {boolean} hasUsableReplies
 * @param {boolean} hasContinuation
 */
export function shouldLoadInitialReplies(hasLoadedBatch, hasUsableReplies, hasContinuation) {
  return !hasLoadedBatch || (!hasUsableReplies && !hasContinuation)
}

/**
 * Matches the error thrown by our patched youtubei.js 17.2.0
 * CommentThread.getReplies() when the reply endpoint structure is missing.
 * Keep this in sync with patches/youtubei.js@17.2.0.patch.
 * @param {unknown} error
 */
export function isMissingReplyResponseError(error) {
  return error instanceof Error &&
    error.message === 'Unexpected response' &&
    'info' in error
}

/**
 * @param {import('youtubei.js').YTNodes.CommentThread} commentThread
 */
export function getReplyContinuationToken(commentThread) {
  const continuation = commentThread.comment_replies_data?.sub_threads
    ?.find(item => item.type === 'ContinuationItem')

  return continuation?.button?.endpoint?.payload?.token ??
    continuation?.endpoint?.payload?.token ??
    null
}
