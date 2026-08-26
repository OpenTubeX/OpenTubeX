import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCommentPinStorageKey,
  getCommentReplyPinMarker,
  hasPinnedCommentReply,
  loadCommentPins,
  saveCommentPins
} from '../../src/renderer/helpers/commentPins.js'

function createMemoryStorage (initialValue = null) {
  let value = initialValue

  return {
    getItem: () => value,
    setItem: (_key, nextValue) => { value = nextValue },
    removeItem: () => { value = null }
  }
}

test('keeps personal comment pins separate by profile and video', () => {
  const storage = createMemoryStorage()
  const firstVideo = getCommentPinStorageKey('profile-a', 'video-a')
  const secondVideo = getCommentPinStorageKey('profile-a', 'video-b')
  const secondProfile = getCommentPinStorageKey('profile-b', 'video-a')

  saveCommentPins(firstVideo, new Set(['comment-a', 'comment-b']), storage)

  assert.deepEqual(loadCommentPins(firstVideo, storage), new Set(['comment-a', 'comment-b']))
  assert.deepEqual(loadCommentPins(secondVideo, storage), new Set())
  assert.deepEqual(loadCommentPins(secondProfile, storage), new Set())
})

test('tracks pinned replies separately from their root comment', () => {
  const firstReplyMarker = getCommentReplyPinMarker('root/comment', 'reply:one')
  const secondReplyMarker = getCommentReplyPinMarker('root/comment', 'reply:two')
  const commentIds = new Set(['reply:one', firstReplyMarker, 'reply:two', secondReplyMarker])

  assert.equal(commentIds.has('root/comment'), false)
  assert.equal(hasPinnedCommentReply(commentIds, 'root/comment'), true)
  assert.equal(hasPinnedCommentReply(commentIds, 'other-root'), false)

  commentIds.delete(firstReplyMarker)
  assert.equal(hasPinnedCommentReply(commentIds, 'root/comment'), true)

  commentIds.delete(secondReplyMarker)
  assert.equal(hasPinnedCommentReply(commentIds, 'root/comment'), false)
})

test('removes empty pin groups and ignores malformed storage', () => {
  const contentKey = getCommentPinStorageKey('profile-a', 'video-a')
  const storage = createMemoryStorage('{not-json')

  assert.deepEqual(loadCommentPins(contentKey, storage), new Set())

  saveCommentPins(contentKey, new Set(['comment-a']), storage)
  saveCommentPins(contentKey, new Set(), storage)

  assert.equal(storage.getItem('opentubex-comment-pins'), null)
})

test('keeps pinning usable when storage is unavailable', () => {
  const contentKey = getCommentPinStorageKey('profile-a', 'video-a')
  const storage = {
    getItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') }
  }

  assert.deepEqual(loadCommentPins(contentKey, storage), new Set())
  assert.doesNotThrow(() => saveCommentPins(contentKey, new Set(['comment-a']), storage))
  assert.doesNotThrow(() => saveCommentPins(contentKey, new Set(), storage))
})
