import { canMarkHistoryEntryAsWatched } from '../../history.js'

export const HOME_SECTION_IDS = Object.freeze([
  'continueWatching',
  'newSinceLastVisit',
  'watchQueue',
  'playlists',
  'recentDownloads',
  'reminders',
  'watchStats',
])

export const DEFAULT_HOME_SECTION_LAYOUT = Object.freeze(
  HOME_SECTION_IDS.map(id => Object.freeze({ id, visible: true }))
)

/**
 * Accepts only layouts for the current Home schema. Home has not shipped yet,
 * so stale development data is reset instead of carrying compatibility code.
 *
 * @param {unknown} layout
 * @returns {{ id: string, visible: boolean }[]}
 */
export function normalizeHomeSectionLayout(layout) {
  if (!Array.isArray(layout) || layout.length !== HOME_SECTION_IDS.length) {
    return DEFAULT_HOME_SECTION_LAYOUT.map(section => ({ ...section }))
  }

  const ids = layout.map(entry => entry?.id)
  if (new Set(ids).size !== HOME_SECTION_IDS.length ||
      ids.some(id => !HOME_SECTION_IDS.includes(id))) {
    return DEFAULT_HOME_SECTION_LAYOUT.map(section => ({ ...section }))
  }

  return layout.map(entry => ({ id: entry.id, visible: entry.visible !== false }))
}

const RECENT_DOWNLOAD_STATUSES = new Set([
  'queued',
  'downloading',
  'processing',
  'pausing',
  'paused',
  'completed',
])

/**
 * @param {object[] | Record<string, object>} downloads
 * @returns {object[]}
 */
export function getRecentDownloads(downloads) {
  const entries = Array.isArray(downloads) ? downloads : Object.values(downloads)
  return entries
    .filter(download => RECENT_DOWNLOAD_STATUSES.has(download.status))
    .toSorted((a, b) => b.id - a.id)
}

/**
 * @param {{ id: string, visible: boolean }[]} layout
 * @param {string} sectionId
 * @param {-1 | 1} offset
 * @returns {{ id: string, visible: boolean }[]}
 */
export function moveHomeSection(layout, sectionId, offset) {
  const normalized = normalizeHomeSectionLayout(layout)
  const index = normalized.findIndex(section => section.id === sectionId)
  const targetIndex = index + offset

  if (index === -1 || targetIndex < 0 || targetIndex >= normalized.length) {
    return normalized
  }

  const reordered = normalized.slice()
  const [section] = reordered.splice(index, 1)
  reordered.splice(targetIndex, 0, section)
  return reordered
}

/**
 * @param {object[]} history
 * @param {number} [limit]
 * @returns {object[]}
 */
export function getContinueWatchingEntries(history, limit = Number.POSITIVE_INFINITY) {
  return history.filter(entry => {
    const progress = Number(entry.watchProgress)
    const duration = Number(entry.lengthSeconds)

    return entry.isWatched !== true &&
      canMarkHistoryEntryAsWatched(entry) &&
      Number.isFinite(progress) &&
      progress > 0 &&
      (!Number.isFinite(duration) || duration <= 0 || progress < duration)
  }).slice(0, limit)
}
