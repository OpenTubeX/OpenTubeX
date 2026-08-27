import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCommentPinSnapshot,
  getCommentPinStorageKey,
  getCommentReplyPinMarker,
  hasPinnedCommentReply,
  loadCommentPins,
  mergePinnedCommentSnapshots,
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

  saveCommentPins(firstVideo, {
    commentIds: new Set(['comment-a', 'comment-b']),
    commentSnapshots: []
  }, storage)

  assert.deepEqual(loadCommentPins(firstVideo, storage), {
    commentIds: new Set(['comment-a', 'comment-b']),
    commentSnapshots: []
  })
  assert.deepEqual(loadCommentPins(secondVideo, storage), {
    commentIds: new Set(),
    commentSnapshots: []
  })
  assert.deepEqual(loadCommentPins(secondProfile, storage), {
    commentIds: new Set(),
    commentSnapshots: []
  })
})

test('restores a pinned comment that is missing from the current response', () => {
  const storage = createMemoryStorage()
  const contentKey = getCommentPinStorageKey('profile-a', 'video-a')
  const pinnedComment = {
    id: 'pinned-comment',
    author: 'Pinned author',
    authorId: 'UCpinned',
    authorLink: 'UCpinned',
    authorThumb: 'https://example.com/pinned.jpg',
    dataType: 'local',
    hasOwnerReplied: false,
    hasReplyToken: true,
    isEdited: false,
    isHearted: false,
    isMember: false,
    isOwner: false,
    isPinned: false,
    likes: 4,
    memberIconUrl: '',
    numReplies: 0,
    published: 123,
    replies: [],
    showReplies: false,
    text: 'Pinned text',
    time: '1 day ago',
    translationText: 'Pinned text'
  }

  saveCommentPins(contentKey, {
    commentIds: new Set([pinnedComment.id]),
    commentSnapshots: [createCommentPinSnapshot(pinnedComment)]
  }, storage)

  const restored = loadCommentPins(contentKey, storage)
  const currentComment = { ...pinnedComment, id: 'current-comment', text: 'Current text' }
  assert.deepEqual(restored.commentIds, new Set([pinnedComment.id]))
  assert.equal(restored.commentSnapshots[0].hasReplyToken, false)
  assert.deepEqual(
    mergePinnedCommentSnapshots([currentComment], restored.commentSnapshots),
    [
      { comment: restored.commentSnapshots[0], index: null, persisted: true },
      { comment: currentComment, index: 0, persisted: false }
    ]
  )

  const livePinnedComment = { ...pinnedComment, text: 'Fresh pinned text' }
  assert.deepEqual(
    mergePinnedCommentSnapshots([currentComment, livePinnedComment], restored.commentSnapshots),
    [
      { comment: currentComment, index: 0, persisted: false },
      { comment: livePinnedComment, index: 1, persisted: false }
    ]
  )
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

  assert.deepEqual(loadCommentPins(contentKey, storage), {
    commentIds: new Set(),
    commentSnapshots: []
  })

  saveCommentPins(contentKey, { commentIds: new Set(['comment-a']), commentSnapshots: [] }, storage)
  saveCommentPins(contentKey, { commentIds: new Set(), commentSnapshots: [] }, storage)

  assert.equal(storage.getItem('opentubex-comment-pins'), null)

  const malformedSnapshotStorage = createMemoryStorage(JSON.stringify({
    [contentKey]: {
      commentIds: ['comment-a'],
      commentSnapshots: [{ id: 'comment-a' }]
    }
  }))
  assert.deepEqual(loadCommentPins(contentKey, malformedSnapshotStorage), {
    commentIds: new Set(['comment-a']),
    commentSnapshots: []
  })
})

test('keeps pinning usable when storage is unavailable', () => {
  const contentKey = getCommentPinStorageKey('profile-a', 'video-a')
  const storage = {
    getItem: () => { throw new Error('storage unavailable') },
    setItem: () => { throw new Error('storage unavailable') },
    removeItem: () => { throw new Error('storage unavailable') }
  }

  assert.deepEqual(loadCommentPins(contentKey, storage), {
    commentIds: new Set(),
    commentSnapshots: []
  })
  assert.doesNotThrow(() => saveCommentPins(contentKey, {
    commentIds: new Set(['comment-a']),
    commentSnapshots: []
  }, storage))
  assert.doesNotThrow(() => saveCommentPins(contentKey, {
    commentIds: new Set(),
    commentSnapshots: []
  }, storage))
})
