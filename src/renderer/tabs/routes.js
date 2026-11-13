// Route snapshots for tab state. The main process validates untrusted routes
// separately and more strictly in src/main/tabs/tabRoutes.js.

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

export function cloneRoute(route) {
  const normalized = normalizeRoute(route)
  return {
    ...normalized,
    params: { ...normalized.params },
    query: cloneQuery(normalized.query)
  }
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

function cloneQuery(query) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
  )
}

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
