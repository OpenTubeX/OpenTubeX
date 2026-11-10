import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCommentReplyCount,
  getReplyContinuationToken,
  getReplyLoadState,
  isMissingReplyResponseError
} from '../../src/renderer/helpers/comment-replies.js'

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
