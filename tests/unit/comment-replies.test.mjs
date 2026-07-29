import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getReplyLoadState,
  shouldLoadInitialReplies
} from '../../src/renderer/helpers/comment-replies.js'

test('keeps an empty reply load retryable without opening the reply panel', () => {
  assert.deepEqual(getReplyLoadState(0, 0, 1, false), {
    hasMore: true,
    showReplies: false,
    shouldRetry: true
  })
})

test('marks a completed reply load as exhausted', () => {
  assert.deepEqual(getReplyLoadState(1, 1, 1, false), {
    hasMore: false,
    showReplies: true,
    shouldRetry: false
  })
})

test('keeps a loaded reply panel open while its continuation is available', () => {
  assert.deepEqual(getReplyLoadState(1, 3, 4, true), {
    hasMore: true,
    showReplies: true,
    shouldRetry: false
  })
})

test('keeps a zero-progress continuation retryable after earlier replies loaded', () => {
  assert.deepEqual(getReplyLoadState(0, 3, 4, false), {
    hasMore: true,
    showReplies: true,
    shouldRetry: true
  })
})

test('retries an unusable initial batch when it has no continuation', () => {
  assert.equal(shouldLoadInitialReplies(true, false, false), true)
})

test('advances after an unusable initial batch when it has a continuation', () => {
  assert.equal(shouldLoadInitialReplies(true, false, true), false)
})
