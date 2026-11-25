export const HOME_SECTION_IDS = Object.freeze([
  'continueWatching',
  'recommendations',
  'youtubeRecommendations',
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
 * Preserves existing Home customization and appends newly available sections.
 *
 * @param {unknown} layout
 * @returns {{ id: string, visible: boolean }[]}
 */
export function normalizeHomeSectionLayout(layout) {
  if (!Array.isArray(layout)) {
    return DEFAULT_HOME_SECTION_LAYOUT.map(section => ({ ...section }))
  }

  const ids = layout.map(entry => entry?.id)
  if (new Set(ids).size !== ids.length ||
      ids.some(id => !HOME_SECTION_IDS.includes(id))) {
    return DEFAULT_HOME_SECTION_LAYOUT.map(section => ({ ...section }))
  }

  return [
    ...layout.map(entry => ({ id: entry.id, visible: entry.visible !== false })),
    ...DEFAULT_HOME_SECTION_LAYOUT.filter(section => !ids.includes(section.id))
      .map(section => ({ ...section })),
  ]
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
 * Cache the stable progress/duration checks separately from premiere timing.
 * @param {object[]} history
 * @returns {object[]}
 */
export function getContinueWatchingCandidates(history) {
  return history.filter(entry => {
    const progress = Number(entry.watchProgress)
    if (!Number.isFinite(progress) || progress <= 0 || entry.isWatched === true) return false
    const duration = Number(entry.lengthSeconds)

    return !Number.isFinite(duration) || duration <= 0 || progress < duration
  })
}
