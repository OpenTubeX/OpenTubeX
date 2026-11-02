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
 * @returns {{ watched: boolean, progress: number, seconds: number } | null} progress from 0 to 1,
 * seconds where playback resumes
 */
export function getExternalMediaProgress(url) {
  // eslint-disable-next-line no-unused-expressions -- Tracks saved positions
  externalMediaPositionVersion.value
  const key = positionKey(url)
  const position = key === null ? null : readPosition(key)
  if (position === null) return null
  const { seconds } = position
  if (position.watched === true) return { watched: true, progress: 1, seconds }
  return { watched: false, progress: position.duration > 0 ? Math.min(seconds / position.duration, 1) : 0, seconds }
}

/**
 * @param {string} key
 * @param {object | null} position removes the saved position when null
 */
function writePosition(key, position) {
  try {
    if (position === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify({ ...position, updatedAt: Date.now() }))
    }
    externalMediaPositionVersion.value++
  } catch (error) {
    console.error('Failed to save external media position:', error)
  }
}

export function saveExternalMediaPosition(url, seconds, duration) {
  const key = positionKey(url)
  if (key === null || !Number.isFinite(seconds) || seconds < 0) return
  const hasDuration = Number.isFinite(duration) && duration > 0
  // A finished video restarts, but lists still show it as watched, also while it's replayed
  const watched = readPosition(key)?.watched === true
  if (hasDuration && seconds >= duration - 2) {
    writePosition(key, { seconds: 0, watched: true })
  } else if (seconds > 0 || watched) {
    writePosition(key, { seconds, ...(hasDuration ? { duration } : {}), ...(watched ? { watched } : {}) })
  } else {
    writePosition(key, null)
  }
}

/**
 * @param {string} url
 * @param {boolean} [fully] also restarts playback from the beginning, as if it had played to the end
 */
export function markExternalMediaWatched(url, fully = false) {
  const key = positionKey(url)
  if (key === null) return
  const { updatedAt, ...position } = (fully ? null : readPosition(key)) ?? { seconds: 0 }
  writePosition(key, { ...position, watched: true })
}

/** Keeps where the media was left, so it still resumes there. */
export function unmarkExternalMediaWatched(url) {
  const key = positionKey(url)
  if (key === null) return
  const { updatedAt, watched, ...position } = readPosition(key) ?? { seconds: 0 }
  writePosition(key, position.seconds > 0 ? position : null)
}

export function removeExternalMediaPositionsBefore(cutoff) {
  removePositions(position => position === null || position.updatedAt < cutoff)
  externalMediaPositionVersion.value++
}

export function clearExternalMediaPositions() {
  removePositions(() => true)
  externalMediaPositionVersion.value++
}
