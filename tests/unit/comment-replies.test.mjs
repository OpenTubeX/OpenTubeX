import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCommentReplyAccessibleLabel,
  getCommentReplyCount,
  getReplyContinuationToken,
  getReplyLoadState,
  isEmptyReplyContinuation,
  isMissingReplyResponseError,
  shouldLoadInitialReplies
} from '../../src/renderer/helpers/comment-replies.js'

test('describes collapsed replies from the video uploader', () => {
  const comment = {
    hasOwnerReplied: true,
    numReplies: 3,
    replies: [],
    showReplies: false
  }

  assert.equal(
    getCommentReplyAccessibleLabel(comment, key => key, 'Uploader'),
    'Comments.View {replyCount} replies from {channelName} and others'
  )
})

test('refreshes a stale advertised count after newer replies load', () => {
  const comment = {
    numReplies: 1,
    replies: [
      { replies: [] },
      { replies: [] },
      { replies: [] }
    ]
  }

  assert.equal(getCommentReplyCount(comment), 3)
})

test('includes nested descendants in the loaded reply count', () => {
  const comment = {
    numReplies: 1,
    replies: [
      { replies: [] },
      {
        replies: [
          { replies: [] },
          { replies: [{ replies: [] }] }
        ]
      }
    ]
  }

  assert.equal(getCommentReplyCount(comment), 5)
})

test('keeps an advertised reply count above the number loaded so far', () => {
  const comment = {
    numReplies: 5,
    replies: [{ replies: [] }]
  }

  assert.equal(getCommentReplyCount(comment), 5)
})

test('exhausts a stale advertised reply without opening the reply panel', () => {
  assert.deepEqual(getReplyLoadState(0, 1, false), {
    hasMore: false,
    hasMissingReplies: true,
    showReplies: false
  })
})

test('marks a completed reply load as exhausted', () => {
  assert.deepEqual(getReplyLoadState(1, 1, false), {
    hasMore: false,
    hasMissingReplies: false,
    showReplies: true
  })
})

test('keeps a loaded reply panel open while its continuation is available', () => {
  assert.deepEqual(getReplyLoadState(3, 4, true), {
    hasMore: true,
    hasMissingReplies: false,
    showReplies: true
  })
})

test('exhausts a zero-progress continuation after earlier replies loaded', () => {
  assert.deepEqual(getReplyLoadState(3, 4, false), {
    hasMore: false,
    hasMissingReplies: true,
    showReplies: true
  })
})

test('reconciles an underfilled final reply page', () => {
  assert.deepEqual(getReplyLoadState(2, 3, false), {
    hasMore: false,
    hasMissingReplies: true,
    showReplies: true
  })
})

test('retries an unusable initial batch when it has no continuation', () => {
  assert.equal(shouldLoadInitialReplies(true, false, false), true)
})

test('advances after an unusable initial batch when it has a continuation', () => {
  assert.equal(shouldLoadInitialReplies(true, false, true), false)
})

test('recognizes an advertised continuation that returns no replies', () => {
  assert.equal(isEmptyReplyContinuation(0, false), true)
  assert.equal(isEmptyReplyContinuation(1, false), false)
  assert.equal(isEmptyReplyContinuation(0, true), false)
})

test('recognizes a missing reply continuation response', () => {
  const missingResponseError = Object.assign(new Error('Unexpected response'), { info: {} })

  assert.equal(isMissingReplyResponseError(missingResponseError), true)
  assert.equal(isMissingReplyResponseError(new Error('Unexpected response')), false)
  assert.equal(isMissingReplyResponseError(Object.assign(new Error('Network error'), { info: {} })), false)
  assert.equal(isMissingReplyResponseError('Unexpected response'), false)
})

test('gets a reply continuation token from its endpoint', () => {
  const commentThread = {
    comment_replies_data: {
      sub_threads: [
        { type: 'CommentThread' },
        { type: 'ContinuationItem', endpoint: { payload: { token: 'reply-token' } } }
      ]
    }
  }

  assert.equal(getReplyContinuationToken(commentThread), 'reply-token')
})

test('prefers a reply continuation button token', () => {
  const commentThread = {
    comment_replies_data: {
      sub_threads: [{
        type: 'ContinuationItem',
        button: { endpoint: { payload: { token: 'button-token' } } },
        endpoint: { payload: { token: 'endpoint-token' } }
      }]
    }
  }

  assert.equal(getReplyContinuationToken(commentThread), 'button-token')
})

test('returns null when a reply continuation is unavailable', () => {
  assert.equal(getReplyContinuationToken({ comment_replies_data: null }), null)
  assert.equal(getReplyContinuationToken({ comment_replies_data: {} }), null)
  assert.equal(getReplyContinuationToken({ comment_replies_data: { sub_threads: undefined } }), null)
})
