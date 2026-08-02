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
 * YouTube can advertise replies that have already been removed from the reply
 * continuation. youtubei.js reports that stale continuation with this error.
 * @param {unknown} error
 */
export function isUnavailableReplyError(error) {
  return error instanceof Error && error.message === 'Unexpected response'
}
