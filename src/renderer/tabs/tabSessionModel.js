/** A normalized renderer route used by tab snapshots and history.
 * @typedef {{name: string | null, path: string, params: Record<string, string | string[]>, query: Record<string, string | string[]>, hash: string, fullPath: string}} TabRoute
 */
/** @typedef {{route: TabRoute, title: string, titlePending?: boolean, scroll?: {left: number, top: number}}} TabHistoryEntry */
/** @typedef {{id: string, route?: TabRoute, url?: string, title?: string, history?: TabHistoryEntry[], historyIndex?: number, syncedNavigationRevision?: number, loadState?: string, pendingReloadRoute?: TabRoute | null, contentTitle?: string, refreshKey?: number}} TabSessionSnapshot */
/** @typedef {TabSessionSnapshot & {route: TabRoute, history: TabHistoryEntry[], historyIndex: number}} RuntimeTab */

const NAV_HISTORY_DISPLAY_LIMIT = 15
const HALF_NAV_HISTORY_DISPLAY_LIMIT = Math.trunc(NAV_HISTORY_DISPLAY_LIMIT / 2)

/** Build the navigation menu from a runtime tab without reading Vuex state.
 * @param {{history: TabHistoryEntry[], historyIndex: number}} tab
 * @param {(entry: TabHistoryEntry) => unknown} getPageIcon
 */
export function getTabHistoryState(tab, getPageIcon) {
  const historyLength = tab.history.length
  let end
  if (tab.historyIndex < HALF_NAV_HISTORY_DISPLAY_LIMIT) {
    end = Math.min(historyLength - 1, NAV_HISTORY_DISPLAY_LIMIT - 1)
  } else if (historyLength - tab.historyIndex < HALF_NAV_HISTORY_DISPLAY_LIMIT + 1) {
    end = historyLength - 1
  } else {
    end = tab.historyIndex + HALF_NAV_HISTORY_DISPLAY_LIMIT
  }

  const options = []
  for (let index = end; index >= Math.max(0, end + 1 - NAV_HISTORY_DISPLAY_LIMIT); index--) {
    const entry = tab.history[index]
    options.push({
      label: entry.title || entry.route.fullPath,
      value: index - tab.historyIndex,
      active: index === tab.historyIndex,
      icon: getPageIcon(entry)
    })
  }

  return {
    canGoBack: tab.historyIndex > 0,
    canGoForward: tab.historyIndex < historyLength - 1,
    options
  }
}

// Snapshots contain plain serializable data. Keep existing references when IPC
// supplies equal values so unrelated metadata does not invalidate Vue consumers.
/** @param {unknown} left @param {unknown} right @returns {boolean} */
function equalSnapshot(left, right) {
  if (left === right) return true
  if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftRecord = /** @type {Record<string, unknown>} */ (left)
  const rightRecord = /** @type {Record<string, unknown>} */ (right)
  const keys = Object.keys(rightRecord)
  return Object.keys(leftRecord).length === keys.length && keys.every(key => (
    Object.hasOwn(leftRecord, key) && equalSnapshot(leftRecord[key], rightRecord[key])
  ))
}

/**
 * @template T
 * @param {T | null | undefined} previous
 * @param {T} incoming
 * @returns {T}
 */
export function reuseEqualSnapshot(previous, incoming) {
  return equalSnapshot(previous, incoming) ? /** @type {T} */ (previous) : incoming
}

/** @param {TabSessionSnapshot[]} previous @param {TabSessionSnapshot[]} incoming @returns {TabSessionSnapshot[]} */
export function reconcileSnapshotList(previous, incoming) {
  const previousById = new Map(previous.map(item => [item.id, item]))
  const items = (Array.isArray(incoming) ? incoming : []).map(item => (
    reuseEqualSnapshot(previousById.get(item.id), item)
  ))
  return reuseEqualSnapshot(previous, items)
}

/** Reconcile an IPC snapshot while retaining renderer-owned navigation until a sync revision changes.
 * @param {RuntimeTab | null | undefined} previous
 * @param {TabSessionSnapshot} incoming
 * @param {(title: string) => string} formatTitle
 * @returns {RuntimeTab}
 */
export function reconcileTab(previous, incoming, formatTitle) {
  if (!previous) {
    return createRuntimeTab(incoming, normalizeRoute(incoming.route ?? routeFromUrl(incoming.url)), formatTitle)
  }

  let history = previous.history
  let historyIndex = previous.historyIndex
  let route = previous.route
  let pendingReloadRoute = previous.pendingReloadRoute
  let contentTitle = previous.contentTitle

  // Ordinary incoming routes echo renderer-owned navigation and can be stale.
  // A sync revision explicitly hands authority to the remote session instead.
  if (
    Number.isInteger(incoming.syncedNavigationRevision) &&
    incoming.syncedNavigationRevision !== previous.syncedNavigationRevision
  ) {
    const incomingRoute = normalizeRoute(incoming.route ?? routeFromUrl(incoming.url))
    const title = formatTitle(incoming.title || incomingRoute.fullPath)
    const restored = restoredHistoryState(incoming, incomingRoute, title)
    history = restored.history
    historyIndex = restored.historyIndex
    route = incomingRoute
    pendingReloadRoute = null
    contentTitle = title
  } else if (incoming.loadState === 'unloaded' && previous.loadState !== 'unloaded') {
    const currentEntry = normalizeHistoryEntry(history[historyIndex] ?? { route })
    history = [currentEntry]
    historyIndex = 0
    route = currentEntry.route
  }

  return reuseEqualSnapshot(previous, {
    ...previous,
    ...incoming,
    route,
    history,
    historyIndex,
    pendingReloadRoute,
    contentTitle,
    refreshKey: incoming.refreshKey ?? previous.refreshKey ?? 0
  })
}

/** @param {TabSessionSnapshot} incoming @param {TabRoute} route @param {(title: string) => string} formatTitle @returns {RuntimeTab} */
function createRuntimeTab(incoming, route, formatTitle) {
  const title = formatTitle(incoming.title || route.fullPath)
  return {
    ...incoming,
    route,
    ...restoredHistoryState(incoming, route, title),
    pendingReloadRoute: null,
    contentTitle: title,
    refreshKey: incoming.refreshKey ?? 0
  }
}

/**
 * Seed a new runtime tab's back/forward history from a persisted history
 * (restored tab sessions), falling back to a single entry for the current
 * route. The tab's live route and title stay authoritative for the current
 * entry, as persisted history can lag slightly behind them.
 */
/**
 * @param {TabSessionSnapshot} incoming
 * @param {TabRoute} route
 * @param {string} title
 * @returns {{history: TabHistoryEntry[], historyIndex: number}}
 */
function restoredHistoryState(incoming, route, title) {
  if (!Array.isArray(incoming.history) || incoming.history.length === 0) {
    return {
      history: [{ route: cloneRoute(route), title, scroll: { left: 0, top: 0 } }],
      historyIndex: 0
    }
  }

  const history = incoming.history.map(normalizeHistoryEntry)
  const historyIndex = typeof incoming.historyIndex === 'number' && Number.isInteger(incoming.historyIndex)
    ? Math.max(0, Math.min(incoming.historyIndex, history.length - 1))
    : history.length - 1

  const currentEntry = history[historyIndex]
  if (currentEntry.route.fullPath !== route.fullPath) {
    currentEntry.route = cloneRoute(route)
  }
  if (title) {
    currentEntry.title = title
  }

  return { history, historyIndex }
}

/** @param {Partial<TabRoute> | null | undefined} route
 * @returns {TabRoute}
 */
export function normalizeRoute(route) {
  const path = typeof route?.path === 'string' && route.path.length > 0
    ? route.path
    : '/'
  const query = normalizeQuery(route?.query)
  const hash = typeof route?.hash === 'string' ? route.hash : ''
  const fullPath = typeof route?.fullPath === 'string' && route.fullPath.length > 0
    ? route.fullPath
    : buildFullPath(path, query, hash)

  return {
    name: typeof route?.name === 'string' ? route.name : null,
    path: path.startsWith('/') ? path : `/${path}`,
    params: normalizeQuery(route?.params),
    query,
    hash,
    fullPath
  }
}

/** @param {Partial<TabRoute> | null | undefined} route
 * @returns {TabRoute}
 */
export function cloneRoute(route) {
  const normalized = normalizeRoute(route)
  return {
    ...normalized,
    params: { ...normalized.params },
    query: cloneQuery(normalized.query)
  }
}

/** @param {Partial<TabHistoryEntry> | null | undefined} entry @returns {TabHistoryEntry} */
export function normalizeHistoryEntry(entry) {
  return {
    route: cloneRoute(entry?.route),
    title: typeof entry?.title === 'string' ? entry.title : entry?.route?.fullPath || '/',
    titlePending: entry?.titlePending === true,
    scroll: normalizeScroll(entry?.scroll)
  }
}

/** @param {Partial<{left: number, top: number}> | null | undefined} scroll @returns {{left: number, top: number}} */
export function normalizeScroll(scroll) {
  return {
    left: typeof scroll?.left === 'number' && Number.isFinite(scroll.left) ? scroll.left : 0,
    top: typeof scroll?.top === 'number' && Number.isFinite(scroll.top) ? scroll.top : 0
  }
}

/** @param {unknown} query @returns {Record<string, string | string[]>} */
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

/** @param {Record<string, string | string[]>} query @returns {Record<string, string | string[]>} */
function cloneQuery(query) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
  )
}

/** @param {string} path @param {Record<string, string | string[]>} query @param {string} hash @returns {string} */
function buildFullPath(path, query, hash) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, item)
    }
  }
  const queryString = search.toString()
  return `${path.startsWith('/') ? path : `/${path}`}${queryString ? `?${queryString}` : ''}${hash}`
}

/** @param {URLSearchParams} searchParams @returns {Record<string, string | string[]>} */
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

/** @param {string | undefined} url @returns {TabRoute} */
function routeFromUrl(url) {
  try {
    if (typeof url !== 'string') return normalizeRoute({ path: '/' })
    const parsed = new URL(url)
    const hashRoute = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
    const routeUrl = new URL(hashRoute || '/', parsed.origin)
    return normalizeRoute({
      path: routeUrl.pathname,
      query: searchParamsToQuery(routeUrl.searchParams),
      hash: routeUrl.hash
    })
  } catch {
    return normalizeRoute({ path: '/' })
  }
}
