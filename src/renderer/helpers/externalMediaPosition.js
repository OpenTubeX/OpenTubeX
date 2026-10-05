const STORAGE_KEY = 'externalMediaPositions'

function readPositions() {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(entries)) return new Map()
    return new Map(entries.filter(entry => Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === 'string' && Number.isFinite(entry[1]?.seconds) && entry[1].seconds >= 0 &&
      Number.isFinite(entry[1]?.updatedAt)))
  } catch {
    return new Map()
  }
}

function writePositions(positions) {
  try {
    if (typeof localStorage === 'undefined') return
    if (positions.size === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify([...positions]))
  } catch (error) {
    console.error('Failed to save external media positions:', error)
  }
}

function positionKey(url) {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

export function getExternalMediaPosition(url, duration) {
  const position = readPositions().get(positionKey(url))?.seconds
  if (!(position > 0)) return null
  // Match normal video playback: a video within two seconds of its end restarts.
  if (Number.isFinite(duration) && position >= duration - 2) return null
  return position
}

export function saveExternalMediaPosition(url, seconds, duration) {
  const key = positionKey(url)
  if (key === null || !Number.isFinite(seconds) || seconds < 0) return
  const positions = readPositions()
  positions.delete(key)
  if (seconds > 0 && !(Number.isFinite(duration) && seconds >= duration - 2)) {
    positions.set(key, { seconds, updatedAt: Date.now() })
  }
  writePositions(positions)
}

export function removeExternalMediaPositionsBefore(cutoff) {
  const positions = readPositions()
  for (const [key, position] of positions) {
    if (position.updatedAt < cutoff) positions.delete(key)
  }
  writePositions(positions)
}

export function clearExternalMediaPositions() {
  writePositions(new Map())
}
