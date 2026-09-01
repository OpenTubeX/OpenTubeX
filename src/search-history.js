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
 * Preserve an existing ID for a matching query and filter preset.
 * @param {{ _id?: string, query: string, lastUpdatedAt: number, searchSettings?: object }} entry
 * @param {{ _id: string, query?: string, lastUpdatedAt: number, searchSettings?: object }[]} existingEntries
 * @returns {ReturnType<typeof normalizeSearchHistoryEntry>}
 */
export function resolveSearchHistoryEntry(entry, existingEntries) {
  const normalizedEntry = normalizeSearchHistoryEntry(entry)
  const entryKey = getSearchHistoryEntryKeyFromEntry(normalizedEntry)
  const existingEntry = existingEntries.find(candidate => {
    return getSearchHistoryEntryKeyFromEntry(candidate) === entryKey
  })

  return {
    ...normalizedEntry,
    _id: existingEntry?._id ?? normalizedEntry._id ?? getSearchHistoryEntryId(
      normalizedEntry.query,
      normalizedEntry.searchSettings
    ),
  }
}

/**
 * @param {{ _id: string, query?: string, lastUpdatedAt: number, searchSettings?: object }} entry
 * @returns {{ _id: string, query: string, lastUpdatedAt: number, searchSettings: ReturnType<typeof normalizeSearchSettings> }}
 */
export function normalizeSearchHistoryEntry(entry) {
  return {
    ...entry,
    query: getSearchHistoryEntryQuery(entry),
    searchSettings: normalizeSearchSettings(entry.searchSettings),
  }
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
