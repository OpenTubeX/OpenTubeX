/**
 * @param {number} parsedReplyCount
 * @param {number} loadedReplyCount
 * @param {number} expectedReplyCount
 * @param {boolean} hasNextContinuation
 */
export function getReplyLoadState(parsedReplyCount, loadedReplyCount, expectedReplyCount, hasNextContinuation) {
  const shouldRetry = parsedReplyCount === 0 && loadedReplyCount < expectedReplyCount

  return {
    hasMore: hasNextContinuation || shouldRetry,
    showReplies: loadedReplyCount > 0,
    shouldRetry
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
 * youtubei.js reports this when a reply continuation response does not contain
 * the expected reply endpoint structure.
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
    .find(item => item.type === 'ContinuationItem')

  return continuation?.button?.endpoint?.payload?.token ??
    continuation?.endpoint?.payload?.token ??
    null
}
