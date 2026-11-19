export const DEFAULT_SEARCH_SETTINGS = Object.freeze({
  prioritize: 'relevance',
  time: '',
  type: 'all',
  duration: '',
  features: Object.freeze([]),
})

/**
 * @param {object | null | undefined} searchSettings
 * @returns {{ prioritize: string, time: string, type: string, duration: string, features: string[] }}
 */
export function normalizeSearchSettings(searchSettings) {
  return {
    prioritize: typeof searchSettings?.prioritize === 'string'
      ? searchSettings.prioritize
      : DEFAULT_SEARCH_SETTINGS.prioritize,
    time: typeof searchSettings?.time === 'string'
      ? searchSettings.time
      : DEFAULT_SEARCH_SETTINGS.time,
    type: typeof searchSettings?.type === 'string'
      ? searchSettings.type
      : DEFAULT_SEARCH_SETTINGS.type,
    duration: typeof searchSettings?.duration === 'string'
      ? searchSettings.duration
      : DEFAULT_SEARCH_SETTINGS.duration,
    features: Array.isArray(searchSettings?.features)
      ? [...new Set(searchSettings.features.filter(feature => typeof feature === 'string'))].sort()
      : [],
  }
}

/**
 * @param {{ _id: string, query?: string }} entry
 * @returns {string}
 */
export function getSearchHistoryEntryQuery(entry) {
  return typeof entry.query === 'string' ? entry.query : entry._id
}

/**
 * @param {string} query
 * @param {object | null | undefined} searchSettings
 * @returns {string}
 */
export function getSearchHistoryEntryKey(query, searchSettings) {
  const settings = normalizeSearchSettings(searchSettings)
  return JSON.stringify([
    query,
    settings.prioritize,
    settings.time,
    settings.type,
    settings.duration,
    settings.features,
  ])
}

/**
 * @param {{ _id: string, query?: string, searchSettings?: object }} entry
 * @returns {string}
 */
export function getSearchHistoryEntryKeyFromEntry(entry) {
  return getSearchHistoryEntryKey(getSearchHistoryEntryQuery(entry), entry.searchSettings)
}

/**
 * @param {string} query
 * @param {object | null | undefined} searchSettings
 * @returns {string}
 */
export function getSearchHistoryEntryId(query, searchSettings) {
  return `search-history:${getSearchHistoryEntryKey(query, searchSettings)}`
}

/**
 * Preserve an existing ID for a matching query and filter preset. A matching
 * entry saved later keeps its newer date and title.
 * @param {{ _id?: string, query: string, lastUpdatedAt: number, searchSettings?: object }} entry
 * @param {{ _id: string, query?: string, lastUpdatedAt: number, searchSettings?: object }[]} existingEntries
 * @returns {ReturnType<typeof normalizeSearchHistoryEntry>}
 */
export function resolveSearchHistoryEntry(entry, existingEntries) {
  const normalizedEntry = normalizeSearchHistoryEntry(entry)
  const entryQuery = getSearchHistoryEntryQuery(normalizedEntry)
  const entryKey = getSearchHistoryEntryKeyFromEntry(normalizedEntry)
  // Only entries with the same query need their full key built.
  const existingEntry = existingEntries.find(candidate => {
    return getSearchHistoryEntryQuery(candidate) === entryQuery &&
      getSearchHistoryEntryKeyFromEntry(candidate) === entryKey
  })

  const resolvedEntry = {
    ...normalizedEntry,
    _id: existingEntry?._id ?? normalizedEntry._id ?? getSearchHistoryEntryId(
      normalizedEntry.query,
      normalizedEntry.searchSettings
    ),
  }
  if (existingEntry == null) return resolvedEntry

  // A link save that waited for its title can finish after a newer save of the same link.
  const isNewer = existingEntry.lastUpdatedAt > resolvedEntry.lastUpdatedAt
  if (isNewer) resolvedEntry.lastUpdatedAt = existingEntry.lastUpdatedAt
  const existingTitle = resolvedEntry.linkType != null && existingEntry.linkType === resolvedEntry.linkType
    ? normalizeSearchHistoryEntry(existingEntry).title
    : undefined
  if (existingTitle !== undefined && (isNewer || resolvedEntry.title === undefined)) resolvedEntry.title = existingTitle
  return resolvedEntry
}

/** Link entries open a video or channel instead of searching for their query, the pasted link. */
export const SEARCH_HISTORY_LINK_TYPES = Object.freeze(['video', 'channel'])

/**
 * Keeps `linkType` and `title` only when they are valid, as imports can
 * contain anything. Clients that predate them ignore both and show the link.
 * @param {{ _id: string, query?: string, lastUpdatedAt: number, searchSettings?: object, linkType?: unknown, title?: unknown }} entry
 * @returns {{ _id: string, query: string, lastUpdatedAt: number, searchSettings: ReturnType<typeof normalizeSearchSettings>, linkType?: 'video' | 'channel', title?: string }}
 */
export function normalizeSearchHistoryEntry(entry) {
  const { linkType, title, ...rest } = entry
  const normalizedEntry = {
    ...rest,
    query: getSearchHistoryEntryQuery(entry),
    searchSettings: normalizeSearchSettings(entry.searchSettings),
  }

  if (SEARCH_HISTORY_LINK_TYPES.includes(linkType)) {
    normalizedEntry.linkType = linkType
    if (typeof title === 'string' && title.trim() !== '') normalizedEntry.title = title
  }

  return normalizedEntry
}

/**
 * Reads a record of an OpenTubeX or FreeTube search history export.
 * @param {unknown} record
 * @returns {ReturnType<typeof normalizeSearchHistoryEntry> | null} null for a record without the required fields
 */
export function parseExportedSearchHistoryEntry(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record) ||
    typeof record._id !== 'string' || typeof record.lastUpdatedAt !== 'number') {
    return null
  }

  const { searchSettings } = record
  return normalizeSearchHistoryEntry({
    _id: record._id,
    query: typeof record.query === 'string' ? record.query : record._id,
    lastUpdatedAt: record.lastUpdatedAt,
    searchSettings: searchSettings !== null && typeof searchSettings === 'object' && !Array.isArray(searchSettings)
      ? searchSettings
      : undefined,
    linkType: record.linkType,
    title: record.title,
  })
}

/**
 * Whether a search history entry is suggested for the text typed so far.
 * Links also match by any part of their title, ignoring case.
 * @param {{ _id: string, query?: string, title?: string }} entry
 * @param {string} text
 * @param {string} lowerCaseText `text` in lower case
 */
export function searchHistoryEntryMatches(entry, text, lowerCaseText) {
  return getSearchHistoryEntryQuery(entry).startsWith(text) ||
    (typeof entry.title === 'string' && entry.title.toLowerCase().includes(lowerCaseText))
}

/**
 * Merge search history without collapsing the same query with different filters.
 * @param {{ _id: string, query?: string, lastUpdatedAt: number, searchSettings?: object }[]} currentEntries
 * @param {{ _id: string, query?: string, lastUpdatedAt: number, searchSettings?: object }[]} importedEntries
 * @returns {ReturnType<typeof normalizeSearchHistoryEntry>[]}
 */
export function mergeSearchHistoryEntries(currentEntries, importedEntries) {
  const entriesByKey = new Map()

  for (const entry of currentEntries) {
    const normalizedEntry = normalizeSearchHistoryEntry(entry)
    entriesByKey.set(getSearchHistoryEntryKeyFromEntry(normalizedEntry), normalizedEntry)
  }

  for (const entry of importedEntries) {
    const normalizedEntry = normalizeSearchHistoryEntry(entry)
    const key = getSearchHistoryEntryKeyFromEntry(normalizedEntry)
    const existingEntry = entriesByKey.get(key)

    if (existingEntry == null || normalizedEntry.lastUpdatedAt > existingEntry.lastUpdatedAt) {
      entriesByKey.set(key, {
        ...normalizedEntry,
        _id: existingEntry?._id ?? getSearchHistoryEntryId(normalizedEntry.query, normalizedEntry.searchSettings),
      })
    }
  }

  return Array.from(entriesByKey.values())
}

/**
 * Sorts search history in place from the most recent entry to the oldest.
 * @param {{ lastUpdatedAt: number }[]} historyItems
 * @returns {{ lastUpdatedAt: number }[]}
 */
export function sortSearchHistoryByLastUpdatedAt(historyItems) {
  return historyItems.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
}

/**
 * Search filters are stored per tab on platforms with logical tabs (Electron and Capacitor).
 * @param {string | null | undefined} presentedTabId
 * @returns {string}
 */
export function getSearchFilterTabId(presentedTabId) {
  return (process.env.IS_ELECTRON || process.env.IS_CAPACITOR) ? (presentedTabId ?? 'web') : 'web'
}

/**
 * Reads the search filters from a search route's query.
 * @param {Record<string, string | string[] | null | undefined>} query
 * @returns {{ prioritize: string, time: string, type: string, duration: string, features: string[] }}
 */
export function getSearchSettingsFromRouteQuery(query) {
  const features = query.features
  return {
    prioritize: query.prioritize ?? DEFAULT_SEARCH_SETTINGS.prioritize,
    time: query.time ?? DEFAULT_SEARCH_SETTINGS.time,
    type: query.type ?? DEFAULT_SEARCH_SETTINGS.type,
    duration: query.duration ?? DEFAULT_SEARCH_SETTINGS.duration,
    // A single feature is a string after a page refresh
    features: typeof features === 'string' ? [features] : (features ?? []),
  }
}
