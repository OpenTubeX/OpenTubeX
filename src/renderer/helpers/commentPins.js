const STORAGE_KEY = 'opentubex-comment-pins'

function readStoredPins(storage) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      return {}
    }

    return Object.fromEntries(Object.entries(stored).map(([contentKey, commentIds]) => [
      contentKey,
      Array.isArray(commentIds) ? commentIds.filter(commentId => typeof commentId === 'string') : []
    ]))
  } catch {
    return {}
  }
}

export function getCommentPinStorageKey(profileId, contentId, isPost = false) {
  return `${profileId}:${isPost ? 'post' : 'video'}:${contentId}`
}

export function loadCommentPins(contentKey, storage = localStorage) {
  return new Set(readStoredPins(storage)[contentKey] ?? [])
}

export function saveCommentPins(contentKey, commentIds, storage = localStorage) {
  const stored = readStoredPins(storage)

  if (commentIds.size === 0) {
    delete stored[contentKey]
  } else {
    stored[contentKey] = Array.from(commentIds)
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
