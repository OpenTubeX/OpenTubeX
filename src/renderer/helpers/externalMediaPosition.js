const STORAGE_PREFIX = 'externalMediaPosition:'

function readPosition(key) {
  try {
    const position = JSON.parse(localStorage.getItem(key) ?? 'null')
    return Number.isFinite(position?.seconds) && position.seconds >= 0 && Number.isFinite(position?.updatedAt)
      ? position
      : null
  } catch {
    return null
  }
}

function removePositions(shouldRemove) {
  try {
    if (typeof localStorage === 'undefined') return
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter(key => key?.startsWith(STORAGE_PREFIX))
    for (const key of keys) {
      if (shouldRemove(readPosition(key))) localStorage.removeItem(key)
    }
  } catch (error) {
    console.error('Failed to remove external media positions:', error)
  }
}

function positionKey(url) {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    return STORAGE_PREFIX + parsed.href
  } catch {
    return null
  }
}

export function getExternalMediaPosition(url, duration) {
  const key = positionKey(url)
  if (key === null) return null
  const position = readPosition(key)?.seconds
  if (!(position > 0)) return null
  // Match normal video playback: a video within two seconds of its end restarts.
  if (Number.isFinite(duration) && position >= duration - 2) return null
  return position
}

export function saveExternalMediaPosition(url, seconds, duration) {
  const key = positionKey(url)
  if (key === null || !Number.isFinite(seconds) || seconds < 0) return
  try {
    if (seconds > 0 && !(Number.isFinite(duration) && seconds >= duration - 2)) {
      localStorage.setItem(key, JSON.stringify({ seconds, updatedAt: Date.now() }))
    } else {
      localStorage.removeItem(key)
    }
  } catch (error) {
    console.error('Failed to save external media position:', error)
  }
}

export function removeExternalMediaPositionsBefore(cutoff) {
  removePositions(position => position === null || position.updatedAt < cutoff)
}

export function clearExternalMediaPositions() {
  removePositions(() => true)
}
