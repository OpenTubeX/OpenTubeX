import { app } from 'electron'
import { getFixedInternalRouteTitle } from '../../internalRoutes.js'

const MAX_PERSISTED_NAV_HISTORY_ENTRIES = 25

/**
 * @typedef {object} NavigationHistoryEntry
 * @property {ReturnType<typeof normalizeRoute>} route
 * @property {string} title
 * @property {boolean} titlePending
 * @property {{left: number, top: number}} scroll
 */

/**
 * Validate and normalize a renderer-provided or persisted back/forward
 * history so only well-formed entries reach the session store and state
 * broadcasts. Returns null when there is nothing usable to keep.
 * @param {unknown} history
 * @param {unknown} historyIndex
 * @returns {{history: NavigationHistoryEntry[], historyIndex: number} | null}
 */
export function sanitizeNavigationHistory(history, historyIndex) {
  if (!Array.isArray(history) || history.length === 0) {
    return null
  }

  const entries = history
    .filter(entry => typeof entry?.route?.path === 'string')
    .map(entry => {
      const route = normalizeRoute(entry.route)
      // `oneTimeTimestamp` must not survive persistence (see stripOneTimeTimestampFromUrl)
      if ('oneTimeTimestamp' in route.query) {
        delete route.query.oneTimeTimestamp
      }
      return {
        route: normalizeRoute(route),
        title: typeof entry.title === 'string' ? entry.title : route.fullPath,
        titlePending: entry.titlePending === true,
        scroll: {
          left: Number.isFinite(entry.scroll?.left) ? entry.scroll.left : 0,
          top: Number.isFinite(entry.scroll?.top) ? entry.scroll.top : 0
        }
      }
    })

  if (entries.length === 0) {
    return null
  }

  const removedCount = entries.length - Math.min(entries.length, MAX_PERSISTED_NAV_HISTORY_ENTRIES)
  const cappedEntries = entries.slice(-MAX_PERSISTED_NAV_HISTORY_ENTRIES)
  const index = Number.isInteger(historyIndex) ? historyIndex - removedCount : cappedEntries.length - 1

  return {
    history: cappedEntries,
    historyIndex: Math.max(0, Math.min(index, cappedEntries.length - 1))
  }
}

/**
 * @param {string} url
 * @returns {string}
 */
export function formatDefaultTabTitle(url) {
  const route = getRouteFromUrl(url)
  return getFixedInternalRouteTitle(route.path) ?? route.fullPath
}

/**
 * @param {string} url
 * @returns {{name: null, path: string, params: Record<string, string>, query: Record<string, string>, hash: string, fullPath: string}}
 */
export function getRouteFromUrl(url) {
  try {
    const parsed = new URL(url)
    const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
    const hashUrl = new URL(rawHash || '/', 'https://opentubex.invalid')
    return normalizeRoute({
      path: hashUrl.pathname,
      query: searchParamsToQuery(hashUrl.searchParams),
      hash: hashUrl.hash
    })
  } catch {
    return normalizeRoute({ path: '/' })
  }
}

/**
 * `oneTimeTimestamp` is only meant to be consumed once by the Watch view
 * (e.g. after a SABR player reload). If it survives into a persisted tab
 * session, restoring the tab jumps to the stale reload position instead of
 * the newer watch progress saved in the history database.
 * @param {string} url
 * @returns {string}
 */
export function stripOneTimeTimestampFromUrl(url) {
  if (typeof url !== 'string' || !url.includes('oneTimeTimestamp=')) {
    return url
  }

  const hashIndex = url.indexOf('#')
  if (hashIndex === -1) {
    return url
  }

  const route = getRouteFromUrl(url)
  if (!('oneTimeTimestamp' in route.query)) {
    return url
  }

  delete route.query.oneTimeTimestamp
  return url.slice(0, hashIndex + 1) + normalizeRoute(route).fullPath
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function getVideoIdFromUrl(url) {
  const parsed = URL.parse(url)
  if (parsed == null) {
    return null
  }

  const route = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  const appVideoId = route.match(/^\/watch\/(?<videoId>[^/?#]+)/)?.groups?.videoId
  if (isValidVideoId(appVideoId)) {
    return appVideoId
  }

  const directVideoId = parsed.searchParams.get('v')
  if (isValidVideoId(directVideoId)) {
    return directVideoId
  }

  const pathVideoId = parsed.pathname.match(/^\/(?:shorts|embed|live)\/(?<videoId>[^/?#]+)/)?.groups?.videoId
  if (isValidVideoId(pathVideoId)) {
    return pathVideoId
  }

  if (parsed.hostname === 'youtu.be') {
    const shortUrlVideoId = parsed.pathname.match(/^\/(?<videoId>[^/?#]+)/)?.groups?.videoId
    if (isValidVideoId(shortUrlVideoId)) {
      return shortUrlVideoId
    }
  }

  return null
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidVideoId(value) {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value)
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function getVideoThumbnailUrl(url) {
  const videoId = getVideoIdFromUrl(url)
  return videoId == null ? null : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

/**
 * @param {string} title
 * @returns {boolean}
 */
function isGenericTitle(title) {
  if (typeof title !== 'string') {
    return true
  }

  const trimmed = title.trim()
  return trimmed.length === 0 || trimmed === app.getName()
}

/**
 * @param {string | undefined} currentTitle
 * @param {string} newTitle
 * @returns {string}
 */
export function resolveTabTitle(currentTitle, newTitle) {
  if (typeof newTitle !== 'string') {
    return currentTitle ?? ''
  }

  if (
    isGenericTitle(newTitle) &&
    currentTitle &&
    !isGenericTitle(currentTitle)
  ) {
    return currentTitle
  }

  return newTitle
}
/**
 * @param {string} route
 * @returns {string}
 */
export function normalizeRoutePath(route) {
  if (typeof route !== 'string' || route.trim().length === 0) {
    return '/'
  }
  return route.startsWith('/') ? route : `/${route}`
}

/**
 * @param {object | undefined | null} query
 * @returns {Record<string, string>}
 */
/**
 * Convert URLSearchParams into a plain query object, preserving repeated keys as
 * arrays while keeping single occurrences as scalars.
 * @param {URLSearchParams} searchParams
 * @returns {Record<string, string | string[]>}
 */
function searchParamsToQuery(searchParams) {
  /** @type {Record<string, string | string[]>} */
  const query = {}
  for (const [key, value] of searchParams) {
    if (key in query) {
      const existing = query[key]
      query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      query[key] = value
    }
  }
  return query
}

function normalizeQuery(query) {
  if (!query || typeof query !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)])
  )
}

/**
 * @param {object} route
 * @returns {{name: string | null, path: string, params: Record<string, string>, query: Record<string, string>, hash: string, fullPath: string}}
 */
export function normalizeRoute(route) {
  const path = normalizeRoutePath(route?.path)
  const query = normalizeQuery(route?.query)
  const hash = typeof route?.hash === 'string' ? route.hash : ''
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      searchParams.append(key, item)
    }
  }
  const search = searchParams.toString()
  return {
    name: typeof route?.name === 'string' ? route.name : null,
    path,
    params: normalizeQuery(route?.params),
    query,
    hash,
    fullPath: `${path}${search.length > 0 ? `?${search}` : ''}${hash}`
  }
}

/**
 * @param {ReturnType<typeof normalizeRoute>} route
 * @returns {ReturnType<typeof normalizeRoute>}
 */
export function cloneRoute(route) {
  return normalizeRoute(route)
}
