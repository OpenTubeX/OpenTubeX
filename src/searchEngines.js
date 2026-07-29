export const DEFAULT_SEARCH_ENGINES = Object.freeze([
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q=%s',
    enabled: true
  },
  {
    id: 'startpage',
    name: 'Startpage',
    url: 'https://www.startpage.com/sp/search?query=%s',
    enabled: true
  },
  {
    id: 'qwant',
    name: 'Qwant',
    url: 'https://www.qwant.com/?q=%s',
    enabled: true
  },
  {
    id: 'brave',
    name: 'Brave Search',
    url: 'https://search.brave.com/search?q=%s',
    enabled: true
  }
])

export const DEFAULT_SEARCH_ENGINES_SETTING = JSON.stringify(DEFAULT_SEARCH_ENGINES)

/**
 * @param {unknown} value
 * @returns {value is { id: string, name: string, url: string, enabled: boolean }}
 */
function isValidCustomEngine(value) {
  if (value == null || typeof value !== 'object') return false

  const engine = /** @type {Record<string, unknown>} */ (value)
  if (
    typeof engine.id !== 'string' ||
    !engine.id.startsWith('custom-') ||
    typeof engine.name !== 'string' ||
    engine.name.trim().length === 0 ||
    engine.name.length > 50 ||
    typeof engine.url !== 'string' ||
    !engine.url.includes('%s') ||
    typeof engine.enabled !== 'boolean'
  ) {
    return false
  }

  try {
    const url = new URL(engine.url.replace('%s', 'query'))
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Keep built-in engine details canonical while preserving enabled states and
 * accepting valid custom engines.
 *
 * @param {unknown} setting
 * @returns {{ id: string, name: string, url: string, icon: string, enabled: boolean }[]}
 */
export function parseSearchEngines(setting) {
  let entries
  try {
    entries = typeof setting === 'string' ? JSON.parse(setting) : setting
  } catch {
    entries = []
  }

  if (!Array.isArray(entries)) entries = []

  const storedById = new Map(entries
    .filter(entry => entry != null && typeof entry === 'object' && typeof entry.id === 'string')
    .map(entry => [entry.id, entry]))

  const builtIns = DEFAULT_SEARCH_ENGINES.map(engine => ({
    ...engine,
    icon: '',
    enabled: typeof storedById.get(engine.id)?.enabled === 'boolean'
      ? storedById.get(engine.id).enabled
      : engine.enabled
  }))

  const custom = entries
    .filter(isValidCustomEngine)
    .slice(0, 20)
    .map(engine => ({
      id: engine.id,
      name: engine.name.trim(),
      url: engine.url,
      icon: '',
      enabled: engine.enabled
    }))

  return [...builtIns, ...custom]
}

/**
 * Resolve favicons directly from the search provider instead of sharing the
 * custom engine's hostname with a third-party favicon service.
 *
 * @param {string} searchUrl
 * @returns {string}
 */
export function getFaviconUrl(searchUrl) {
  try {
    return new URL('/favicon.ico', new URL(searchUrl.replaceAll('%s', 'query')).origin).href
  } catch {
    return ''
  }
}

/**
 * @param {string} template
 * @param {string} query
 * @returns {string}
 */
export function buildSearchUrl(template, query) {
  return template.replaceAll('%s', encodeURIComponent(query))
}
