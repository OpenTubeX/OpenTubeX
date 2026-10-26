const STORAGE_KEY = 'opentubex-comment-pins'
const REPLY_PIN_MARKER_PREFIX = 'opentubex-reply-pin:'

const COMMENT_STRING_FIELDS = [
  'author',
  'authorId',
  'authorLink',
  'authorThumb',
  'dataType',
  'memberIconUrl',
  'text',
  'time',
  'translatedLanguage',
  'translatedText',
  'translationText'
]
const COMMENT_BOOLEAN_FIELDS = [
  'authorVerified',
  'authorVerifiedArtist',
  'hasOwnerReplied',
  'isEdited',
  'isHearted',
  'isMember',
  'isOwner',
  'isPinned',
  'showReplies',
  'showTranslated'
]
const COMMENT_NUMBER_FIELDS = ['likes', 'numReplies', 'published']

function getReplyPinMarkerPrefix(rootCommentId) {
  return `${REPLY_PIN_MARKER_PREFIX}${encodeURIComponent(rootCommentId)}:`
}

function sanitizeImageDimensions(image) {
  return Object.fromEntries(['width', 'height'].flatMap(field => {
    const value = image[field]
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? [[field, value]] : []
  }))
}

function sanitizeImageAttachment(attachment) {
  if (attachment === null || typeof attachment !== 'object' || Array.isArray(attachment)) return null

  const sources = Array.isArray(attachment.image?.sources)
    ? attachment.image.sources.filter(source => {
        if (source === null || typeof source !== 'object' || Array.isArray(source) || typeof source.url !== 'string') return false
        try {
          return new URL(source.url).protocol === 'https:'
        } catch {
          return false
        }
      }).map(source => ({ url: source.url, ...sanitizeImageDimensions(source) }))
    : []
  if (sources.length === 0 && (typeof attachment.unavailableText !== 'string' || attachment.unavailableText === '')) return null

  const snapshot = { ...sanitizeImageDimensions(attachment), image: { sources } }
  if (typeof attachment.unavailableText === 'string') {
    snapshot.unavailableText = attachment.unavailableText
  }
  const label = attachment.rendererContext?.accessibilityContext?.label
  if (typeof label === 'string') {
    snapshot.rendererContext = { accessibilityContext: { label } }
  }
  return snapshot
}

function sanitizeCommentSnapshot(comment) {
  if (comment === null || typeof comment !== 'object' || Array.isArray(comment) ||
    typeof comment.id !== 'string' || comment.id === '' ||
    typeof comment.author !== 'string' || typeof comment.text !== 'string' ||
    !Array.isArray(comment.replies)) {
    return null
  }

  const snapshot = {
    id: comment.id,
    hasReplyToken: false,
    replies: []
  }

  for (const field of COMMENT_STRING_FIELDS) {
    if (typeof comment[field] === 'string') {
      snapshot[field] = comment[field]
    }
  }

  for (const field of COMMENT_BOOLEAN_FIELDS) {
    if (typeof comment[field] === 'boolean') {
      snapshot[field] = comment[field]
    }
  }

  for (const field of COMMENT_NUMBER_FIELDS) {
    if (typeof comment[field] === 'number' && Number.isFinite(comment[field])) {
      snapshot[field] = comment[field]
    }
  }

  const imageAttachment = sanitizeImageAttachment(comment.imageAttachment)
  if (imageAttachment) snapshot.imageAttachment = imageAttachment

  snapshot.replies = comment.replies
    .map(sanitizeCommentSnapshot)
    .filter(Boolean)

  return snapshot
}

function normalizePinState(pinState) {
  if (pinState === null || typeof pinState !== 'object' || Array.isArray(pinState)) {
    return { commentIds: [], commentSnapshots: [] }
  }

  const commentIds = Array.isArray(pinState.commentIds)
    ? pinState.commentIds.filter(commentId => typeof commentId === 'string')
    : []
  const commentIdSet = new Set(commentIds)
  const commentSnapshots = Array.isArray(pinState.commentSnapshots)
    ? pinState.commentSnapshots
        .map(sanitizeCommentSnapshot)
        .filter(snapshot => snapshot !== null && (
          commentIdSet.has(snapshot.id) || hasPinnedCommentReply(commentIdSet, snapshot.id)
        ))
    : []

  return { commentIds, commentSnapshots }
}

function readStoredPins(storage) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      return {}
    }

    return Object.fromEntries(Object.entries(stored).map(([contentKey, pinState]) => [
      contentKey,
      normalizePinState(pinState)
    ]))
  } catch {
    return {}
  }
}

export function createCommentPinSnapshot(comment) {
  return sanitizeCommentSnapshot(comment)
}

export function getCommentPinStorageKey(profileId, contentId, isPost = false) {
  return `${profileId}:${isPost ? 'post' : 'video'}:${contentId}`
}

export function getCommentReplyPinMarker(rootCommentId, replyId) {
  return `${getReplyPinMarkerPrefix(rootCommentId)}${encodeURIComponent(replyId)}`
}

export function hasPinnedCommentReply(commentIds, rootCommentId) {
  const markerPrefix = getReplyPinMarkerPrefix(rootCommentId)
  return Array.from(commentIds).some(commentId => commentId.startsWith(markerPrefix))
}

export function loadCommentPins(contentKey, storage = localStorage) {
  const pinState = readStoredPins(storage)[contentKey] ?? { commentIds: [], commentSnapshots: [] }
  return {
    commentIds: new Set(pinState.commentIds),
    commentSnapshots: pinState.commentSnapshots
  }
}

export function mergePinnedCommentSnapshots(liveComments, commentSnapshots) {
  const liveCommentIds = new Set(liveComments.map(comment => comment.id))
  const persistedEntries = commentSnapshots
    .filter(comment => !liveCommentIds.has(comment.id))
    .map(comment => ({ comment, index: null, persisted: true }))
  const liveEntries = liveComments.map((comment, index) => ({
    comment,
    index,
    persisted: false
  }))

  return persistedEntries.concat(liveEntries)
}

export function saveCommentPins(contentKey, { commentIds, commentSnapshots }, storage = localStorage) {
  const stored = readStoredPins(storage)

  if (commentIds.size === 0) {
    delete stored[contentKey]
  } else {
    stored[contentKey] = normalizePinState({
      commentIds: Array.from(commentIds),
      commentSnapshots
    })
  }

  try {
    if (Object.keys(stored).length === 0) {
      storage.removeItem(STORAGE_KEY)
    } else {
      storage.setItem(STORAGE_KEY, JSON.stringify(stored))
    }
  } catch {
    // Keep pinning usable for the current view when storage is unavailable.
  }
}
