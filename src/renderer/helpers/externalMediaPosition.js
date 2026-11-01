import { shallowRef } from 'vue'

const STORAGE_PREFIX = 'externalMediaPosition:'

/** Changes whenever a position is saved, so lists can show the new progress. */
export const externalMediaPositionVersion = shallowRef(0)

if (typeof window !== 'undefined') {
  // Other windows save positions too
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) externalMediaPositionVersion.value++
  })
}

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

/**
 * How far the media was watched, for progress bars in lists.
 * @param {string} url
 * @returns {{ watched: boolean, progress: number } | null} progress from 0 to 1
 */
export function getExternalMediaProgress(url) {
  // eslint-disable-next-line no-unused-expressions -- Tracks saved positions
  externalMediaPositionVersion.value
  const key = positionKey(url)
  const position = key === null ? null : readPosition(key)
  if (position === null) return null
  if (position.watched === true) return { watched: true, progress: 1 }
  return position.duration > 0 ? { watched: false, progress: Math.min(position.seconds / position.duration, 1) } : null
}

export function saveExternalMediaPosition(url, seconds, duration) {
  const key = positionKey(url)
  if (key === null || !Number.isFinite(seconds) || seconds < 0) return
  const hasDuration = Number.isFinite(duration) && duration > 0
  try {
    // A finished video restarts, but lists still show it as watched, also while it's replayed
    const watched = readPosition(key)?.watched === true
    if (hasDuration && seconds >= duration - 2) {
      localStorage.setItem(key, JSON.stringify({ seconds: 0, watched: true, updatedAt: Date.now() }))
    } else if (seconds > 0 || watched) {
      localStorage.setItem(key, JSON.stringify({
        seconds,
        ...(hasDuration ? { duration } : {}),
        ...(watched ? { watched } : {}),
        updatedAt: Date.now()
      }))
    } else {
      localStorage.removeItem(key)
    }
    externalMediaPositionVersion.value++
  } catch (error) {
    console.error('Failed to save external media position:', error)
  }
}

export function removeExternalMediaPositionsBefore(cutoff) {
  removePositions(position => position === null || position.updatedAt < cutoff)
  externalMediaPositionVersion.value++
}

export function clearExternalMediaPositions() {
  removePositions(() => true)
  externalMediaPositionVersion.value++
}
