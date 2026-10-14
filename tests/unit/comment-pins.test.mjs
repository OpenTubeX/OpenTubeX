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

test('restores image-only pinned comments and replies with their attachments', () => {
  const imageAttachment = {
    width: 120,
    height: 240,
    image: { sources: [{ url: 'https://images.test/animation.webp?rs=signed', width: 120, height: 240 }] },
    unavailableText: 'GIF unavailable',
    rendererContext: { accessibilityContext: { label: 'Comment image attachment' } }
  }
  for (const pinReply of [false, true]) {
    const storage = createMemoryStorage()
    const comment = { id: 'root', author: 'Viewer', text: '', replies: [] }
    const target = pinReply
      ? { id: 'reply', author: 'Reply viewer', text: '', replies: [], imageAttachment }
      : { ...comment, imageAttachment }
    if (pinReply) comment.replies.push(target)
    const root = pinReply ? comment : target
    const commentIds = new Set([target.id])
    if (pinReply) commentIds.add(getCommentReplyPinMarker(root.id, target.id))

    saveCommentPins('profile:video', {
      commentIds,
      commentSnapshots: [createCommentPinSnapshot(root)]
    }, storage)
    const restored = loadCommentPins('profile:video', storage)
    const entries = mergePinnedCommentSnapshots([], restored.commentSnapshots)
    const restoredTarget = pinReply ? entries[0].comment.replies[0] : entries[0].comment
    assert.equal(entries[0].persisted, true)
    assert.equal(restoredTarget.text, '')
    assert.deepEqual(restoredTarget.imageAttachment, imageAttachment)
  }
})

test('validates pinned attachment data and excludes unrelated payload fields', () => {
  const imageAttachment = {
    width: 120,
    height: '240',
    image: {
      sources: [
        null,
        { url: 'javascript:alert(1)' },
        { url: 'http://images.test/insecure.webp' },
        { url: 'https://' },
        { url: 'https://images.test/animation.webp', width: Infinity, height: -1, extra: 'omit' }
      ]
    },
    unavailableText: 'GIF unavailable',
    rendererContext: { accessibilityContext: { label: 'Comment image attachment' }, loggingContext: 'omit' },
    extra: 'omit'
  }
  const storage = createMemoryStorage(JSON.stringify({
    'profile:video': {
      commentIds: ['pinned'],
      commentSnapshots: [{ id: 'pinned', author: 'Viewer', text: '', replies: [], imageAttachment }]
    }
  }))
  assert.deepEqual(loadCommentPins('profile:video', storage).commentSnapshots[0].imageAttachment, {
    width: 120,
    image: { sources: [{ url: 'https://images.test/animation.webp' }] },
    unavailableText: 'GIF unavailable',
    rendererContext: { accessibilityContext: { label: 'Comment image attachment' } }
  })
  for (const invalid of [null, [], 'invalid', {}, { unavailableText: true }, { image: { sources: [{ url: 'javascript:alert(1)' }] } }]) {
    assert.equal(createCommentPinSnapshot({
      id: 'pinned', author: 'Viewer', text: '', replies: [], imageAttachment: invalid
    }).imageAttachment, undefined)
  }
})

test('saves and restores attachments without URL.canParse', t => {
  const descriptor = Object.getOwnPropertyDescriptor(URL, 'canParse')
  delete URL.canParse
  t.after(() => Object.defineProperty(URL, 'canParse', descriptor))
  const storage = createMemoryStorage()
  const imageAttachment = { image: { sources: [
    { url: 'https://' },
    { url: 'http://images.test/insecure.webp' },
    { url: 'https://images.test/animation.webp', width: 120, height: 240 }
  ] } }
  saveCommentPins('profile:video', {
    commentIds: new Set(['pinned']),
    commentSnapshots: [createCommentPinSnapshot({ id: 'pinned', author: 'Viewer', text: '', replies: [], imageAttachment })]
  }, storage)
  assert.deepEqual(loadCommentPins('profile:video', storage).commentSnapshots[0].imageAttachment.image.sources, [
    { url: 'https://images.test/animation.webp', width: 120, height: 240 }
  ])
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
