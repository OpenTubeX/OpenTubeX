/**
 * @param {{ replies: object[] }} comment
 * @returns {number}
 */
function countLoadedReplies(comment) {
  return comment.replies.reduce((count, reply) => count + 1 + countLoadedReplies(reply), 0)
}

/**
 * @param {{ numReplies: number, replies: object[] }} comment
 * @returns {number}
 */
export function getCommentReplyCount(comment) {
  return Math.max(comment.numReplies, countLoadedReplies(comment))
}

/**
 * @param {{ hasOwnerReplied?: boolean, numReplies: number, replies: object[], showReplies: boolean }} comment
 * @param {(key: string, values: object, count: number) => string} translate
 * @param {string} channelName
 */
export function getCommentReplyAccessibleLabel(comment, translate, channelName) {
  const replyCount = getCommentReplyCount(comment)

  if (comment.showReplies) {
    return translate('Comments.Hide {replyCount} replies', { replyCount }, replyCount)
  }

  if (comment.hasOwnerReplied) {
    if (replyCount > 1) {
      return translate(
        'Comments.View {replyCount} replies from {channelName} and others',
        { replyCount, channelName },
        replyCount
      )
    }

    return translate('Comments.View 1 reply from {channelName}', { channelName }, 1)
  }

  return translate('Comments.Reply Count', { replyCount }, replyCount)
}

/**
 * @param {number} loadedReplyCount
 * @param {number} expectedReplyCount
 * @param {boolean} hasNextContinuation
 */
export function getReplyLoadState(loadedReplyCount, expectedReplyCount, hasNextContinuation) {
  const hasMissingReplies = loadedReplyCount < expectedReplyCount &&
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
 * @param {number} loadedBatchCount
 * @param {boolean} hasNextContinuation
 */
export function isEmptyReplyContinuation(loadedBatchCount, hasNextContinuation) {
  return loadedBatchCount === 0 && !hasNextContinuation
}

/**
 * Matches the error thrown by youtubei.js CommentThread.getReplies() when the
 * reply endpoint structure is missing.
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
