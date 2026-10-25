/** @typedef {import('./api/local').LocalComment | import('./api/invidious').InvidiousComment} Comment */

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

function normalizeCommentAuthor(author) {
  return String(author)
    .replaceAll(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
}

/**
 * YouTube represents replies to replies as a leading channel mention rather
 * than exposing their parent comment ID through the comments APIs.
 *
 * @param {string} html
 * @returns {{ channelId: string, handle: string, author: string } | null}
 */
function getLeadingMention(html) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const firstAnchor = document.body.querySelector('a')

  if (!firstAnchor) {
    return null
  }

  const precedingContent = document.createRange()
  precedingContent.setStart(document.body, 0)
  precedingContent.setEndBefore(firstAnchor)

  if (normalizeCommentAuthor(precedingContent.toString()) !== '') {
    return null
  }

  const href = firstAnchor.getAttribute('href') ?? ''
  const channelId = /\/channel\/([^/?#]+)/.exec(href)?.[1] ?? ''
  // Mentions can link via a handle URL (`/@handle`) rather than `/channel/…`,
  // in which case the anchor text is often the display name, not the handle
  const handle = /\/@([^/?#]+)/.exec(href)?.[1] ?? ''

  return {
    channelId,
    handle: normalizeCommentAuthor(handle),
    author: normalizeCommentAuthor(firstAnchor.textContent)
  }
}

/**
 * @param {Comment} comment
 * @param {{ channelId: string, handle: string, author: string }} mention
 */
function commentMatchesMention(comment, mention) {
  const channelIds = [comment.authorId, comment.authorLink].filter(Boolean)
  const author = normalizeCommentAuthor(comment.author)

  return (mention.channelId !== '' && channelIds.includes(mention.channelId)) ||
    (mention.handle !== '' && author === mention.handle) ||
    author === mention.author
}

/**
 * @param {Comment} comment
 */
export function buildReplyTree(comment) {
  if (comment.dataType === 'local') {
    return comment.replies.map((reply, index) => {
      return {
        reply,
        index,
        children: buildReplyTree(reply)
      }
    })
  }

  const roots = []
  const previousNodes = []

  comment.replies.forEach((reply, index) => {
    const node = { reply, index, children: [] }
    const mention = getLeadingMention(reply.text)
    let parent = null

    if (mention && !commentMatchesMention(comment, mention)) {
      for (let previousIndex = previousNodes.length - 1; previousIndex >= 0; previousIndex--) {
        if (commentMatchesMention(previousNodes[previousIndex].reply, mention)) {
          parent = previousNodes[previousIndex]
          break
        }
      }
    }

    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }

    previousNodes.push(node)
  })

  return roots
}
