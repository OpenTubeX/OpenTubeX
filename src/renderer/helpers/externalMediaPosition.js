import { shallowRef } from 'vue'
import { getRetentionCutoff } from '../../history.js'

const STORAGE_PREFIX = 'externalMediaPosition:'

/** Changes whenever a position is saved, so lists can show the new progress. */
export const externalMediaPositionVersion = shallowRef(0)

if (typeof window !== 'undefined') {
  // Other windows save positions too
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) externalMediaPositionVersion.value++
  })
}

function parsePosition(value) {
  try {
    const position = JSON.parse(value ?? 'null')
    return Number.isFinite(position?.seconds) && position.seconds >= 0 && Number.isFinite(position?.updatedAt)
      ? position
      : null
  } catch {
    return null
  }
}

function readPosition(key) {
  try {
    return parsePosition(localStorage.getItem(key))
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

/**
 * Unlike reading one position, this throws: a missing position would be synced as removed.
 * @returns {{ positions: Map<string, { url: string, seconds: number, duration?: number, watched?: true, updatedAt: number }>, unreadable: string[] }}
 */
function readSavedPositions() {
  const positions = new Map()
  const unreadable = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(STORAGE_PREFIX)) continue
    const url = key.slice(STORAGE_PREFIX.length)
    if (positionKey(url) !== key) continue
    const position = parsePosition(localStorage.getItem(key))
    if (position === null) unreadable.push(url)
    else positions.set(url, { url, ...toSyncedPosition(position) })
  }
  return { positions, unreadable }
}

function toSyncedPosition({ seconds, duration, watched, updatedAt }) {
  return {
    seconds,
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...(watched === true ? { watched } : {}),
    updatedAt,
  }
}

function parseSyncedPositions(entries) {
  const positions = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry?.url !== 'string' || positionKey(entry.url) !== STORAGE_PREFIX + entry.url ||
        !Number.isFinite(entry.seconds) || entry.seconds < 0 || !Number.isFinite(entry.updatedAt)) continue
    const position = { url: entry.url, ...toSyncedPosition(entry) }
    const current = positions.get(entry.url)
    if (!current || position.updatedAt > current.updatedAt) positions.set(entry.url, position)
  }
  return positions
}

/**
 * Merges local and synced positions by URL. The newest save wins, and the
 * previous sync's timestamps tell a deletion apart from a position the other
 * side has not seen yet.
 * @param {Map<string, { updatedAt: number }>} local
 * @param {Map<string, { updatedAt: number }>} remote
 * @param {Record<string, number>} previous URL to `updatedAt` after the previous sync
 * @param {number | null} cutoff Positions saved before this are dropped
 */
export function mergeExternalMediaPositions(local, remote, previous, cutoff) {
  const merged = new Map()
  for (const url of new Set([...local.keys(), ...remote.keys()])) {
    const localPosition = local.get(url)
    const remotePosition = remote.get(url)
    const synced = Object.hasOwn(previous, url) ? previous[url] : null
    let position
    if (localPosition && remotePosition) {
      position = remotePosition.updatedAt > localPosition.updatedAt ? remotePosition : localPosition
    } else {
      position = localPosition ?? remotePosition
      // The other side removed a position it had synced, unless it was saved again since.
      if (synced !== null && position.updatedAt <= synced) continue
    }
    if (cutoff !== null && position.updatedAt < cutoff) continue
    merged.set(url, position)
  }
  return merged
}

/**
 * Syncs positions with the `externalMediaPositions` collection.
 * @param {{ getExternalMediaPositions: () => Promise<unknown>, putExternalMediaPositions: (entries: object[]) => Promise<void> }} client
 * @param {unknown} baseline URL to `updatedAt` of the positions both sides had synced
 * @param {unknown} retentionDays The history retention setting
 * @returns {Promise<{ synced: Record<string, number>, retryBaseline: Record<string, number> }>}
 *   `synced` is the baseline for the next sync. If the upload conflicts, merge
 *   again with `retryBaseline`, which also holds the downloaded positions saved locally.
 */
export async function syncExternalMediaPositions(client, baseline, retentionDays) {
  const remote = parseSyncedPositions(await client.getExternalMediaPositions())
  const { positions: local, unreadable } = readSavedPositions()
  const previous = { ...(baseline && typeof baseline === 'object' && !Array.isArray(baseline) ? baseline : {}) }
  // A damaged saved value is not a removal. The synced position replaces it.
  for (const url of unreadable) delete previous[url]
  const merged = mergeExternalMediaPositions(local, remote, previous, getRetentionCutoff(retentionDays))
  let changed = false
  try {
    for (const url of local.keys()) {
      if (merged.has(url)) continue
      localStorage.removeItem(STORAGE_PREFIX + url)
      changed = true
    }
    for (const [url, position] of merged) {
      if (local.get(url) === position) continue
      localStorage.setItem(STORAGE_PREFIX + url, JSON.stringify(toSyncedPosition(position)))
      changed = true
    }
  } finally {
    if (changed) externalMediaPositionVersion.value++
  }
  await client.putExternalMediaPositions([...merged.values()])
  const timestamps = positions => Object.fromEntries([...positions].map(([url, position]) => [url, position.updatedAt]))
  return { synced: timestamps(merged), retryBaseline: { ...previous, ...timestamps(remote) } }
}
