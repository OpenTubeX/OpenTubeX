// @ts-check

/**
 * The RSSHub documentation keeps its public instance list in this component.
 * There is no machine-readable list, so its entries are read from the source.
 */
const INSTANCE_LIST_URL = 'https://raw.githubusercontent.com/RSSNext/rsshub-docs/main/.vitepress/theme/components/InstanceList.vue'
const FETCH_TIMEOUT_MS = 30_000

/**
 * @typedef {{ url: string, location: string }} RssHubInstance
 * @typedef {string | { description?: string, options?: { value: string, label: string }[], default?: string }} RssHubParameterInfo
 * @typedef {{
 *   name?: string,
 *   example?: string,
 *   parameters?: Record<string, RssHubParameterInfo>,
 *   features?: { requireConfig?: boolean | { optional?: boolean }[] }
 * }} RssHubApiRoute
 * @typedef {{ name?: string, url?: string, routes?: Record<string, RssHubApiRoute> }} RssHubApiNamespace
 * @typedef {{
 *   name: string,
 *   description: string,
 *   options: { value: string, label: string }[],
 *   default: string,
 *   optional: boolean,
 *   allowsSlashes: boolean,
 *   example: string
 * }} RssHubParameter
 * @typedef {{ path: string, name: string, parameters: RssHubParameter[], requiresConfig: boolean }} RssHubRoute
 * @typedef {{ id: string, name: string, url: string, routes: RssHubRoute[] }} RssHubService
 */

/**
 * Requests go through the native HTTP client on mobile, as self-hosted
 * servers don't send CORS headers or always use HTTPS.
 * @param {string} url
 * @param {RequestInit} options
 */
export async function appFetch(url, options) {
  if (process.env.IS_CAPACITOR) {
    const { capacitorHttpFetch } = await import('./api/capacitor-http')
    return await capacitorHttpFetch(url, { ...options, allowHttp: true })
  }
  return await fetch(url, options)
}

/**
 * @param {string} url
 */
async function fetchText(url) {
  const response = await appFetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return await response.text()
}

/**
 * @param {string} source the InstanceList.vue component
 * @returns {RssHubInstance[]}
 */
export function parseRssHubInstanceList(source) {
  const instances = []
  for (const [entry] of source.matchAll(/\{[^{}]*\burl:\s*'[^']+'[^{}]*\}/g)) {
    const url = normalizeRssHubInstance(entry.match(/\burl:\s*'([^']+)'/)?.[1] ?? '')
    if (url && !instances.some(instance => instance.url === url)) {
      instances.push({ url, location: entry.match(/\blocation:\s*'([^']*)'/)?.[1] ?? '' })
    }
  }
  return instances
}

/** @type {Promise<RssHubInstance[]> | null} */
let instanceListRequest = null

/**
 * The public instances, loaded once per session.
 */
export function fetchRssHubInstances() {
  instanceListRequest ??= fetchText(INSTANCE_LIST_URL)
    .then(parseRssHubInstanceList)
    .catch(error => {
      instanceListRequest = null
      throw error
    })
  return instanceListRequest
}

/**
 * Accepts a bare host as well as a full address. Instances can live below a
 * path, so only a trailing slash, query and fragment are dropped.
 * @param {string} value
 * @returns {string | null}
 */
export function normalizeRssHubInstance(value) {
  const text = value.trim()
  if (text === '') return null
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/**
 * @param {string} path
 * @param {RssHubApiRoute} route
 * @param {string} namespace
 * @returns {RssHubParameter[]}
 */
function routeParameters(path, route, namespace) {
  const segments = path.split('/').filter(Boolean)
  // The example shows a value for each parameter that it reaches
  const exampleSegments = (route.example ?? '').split('?')[0].split('/').filter(Boolean)
  const exampleAligns = exampleSegments[0] === namespace && !segments.some(segment => /\{.*\}/.test(segment))

  return segments.flatMap((segment, index) => {
    const match = segment.match(/^:(\w+)(\{.*\})?(\?)?$/)
    if (!match) return []
    const [, name, pattern = '', optional] = match
    const info = route.parameters?.[name]
    const details = typeof info === 'object' && info !== null ? info : { description: info }
    let example = exampleAligns ? exampleSegments[index + 1] ?? '' : ''
    try {
      example = decodeURIComponent(example)
    } catch { }
    return [{
      name,
      description: details.description?.trim() ?? '',
      options: Array.isArray(details.options) ? details.options : [],
      default: details.default ?? '',
      optional: optional === '?',
      allowsSlashes: pattern.includes('.'),
      example
    }]
  })
}

/**
 * @param {RssHubApiRoute} route
 */
function routeRequiresConfig(route) {
  const requireConfig = route.features?.requireConfig
  return Array.isArray(requireConfig) ? requireConfig.some(config => !config.optional) : requireConfig === true
}

/**
 * Turns the response of an instance's /api/namespace endpoint into a sorted
 * service list. Routes with several paths are listed once for each path.
 * @param {Record<string, RssHubApiNamespace>} namespaces
 * @returns {RssHubService[]}
 */
export function parseRssHubNamespaces(namespaces) {
  return Object.entries(namespaces)
    .map(([id, namespace]) => {
      const entries = Object.entries(namespace.routes ?? {})
      /** @type {Map<string, number>} */
      const nameCounts = new Map()
      for (const [path, route] of entries) {
        const name = route.name || path
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
      }
      return {
        id,
        name: namespace.name || id,
        url: namespace.url ?? '',
        routes: entries.map(([path, route]) => {
          const name = route.name || path
          return {
            path,
            name: (nameCounts.get(name) ?? 0) > 1 ? `${name} (${path})` : name,
            parameters: routeParameters(path, route, id),
            requiresConfig: routeRequiresConfig(route)
          }
        })
      }
    })
    .filter(service => service.routes.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** @type {Map<string, Promise<RssHubService[]>>} */
const serviceRequests = new Map()

/**
 * The services that an instance supports, loaded once per instance and session.
 * @param {string} instance a normalized instance address
 */
export function fetchRssHubServices(instance) {
  let request = serviceRequests.get(instance)
  if (!request) {
    request = fetchText(`${instance}/api/namespace`)
      .then(text => parseRssHubNamespaces(JSON.parse(text)))
      .catch(error => {
        serviceRequests.delete(instance)
        throw error
      })
    serviceRequests.set(instance, request)
  }
  return request
}

/**
 * Builds the feed address for a route. Optional parameters can only be left
 * out at the end of the path, so an empty one before a filled one takes its
 * default value. Trailing defaults are left out, matching the shortest address
 * of the feed.
 * @param {string} instance a normalized instance address
 * @param {string} namespace
 * @param {RssHubRoute} route
 * @param {Record<string, string>} values
 * @returns {{ url: string | null, missing: string[] }}
 */
export function buildRssHubFeedUrl(instance, namespace, route, values) {
  const value = (/** @type {string} */ name) => values[name]?.trim() ?? ''
  const parameters = new Map(route.parameters.map(parameter => [parameter.name, parameter]))
  const segments = route.path.split('/').filter(Boolean)
  const lastFilled = segments.findLastIndex(segment => {
    const name = segment.match(/^:(\w+)/)?.[1]
    const parameter = name === undefined ? undefined : parameters.get(name)
    return !parameter?.optional || ![parameter.default, ''].includes(value(parameter.name))
  })

  /** @type {string[]} */
  const missing = []
  const path = segments.slice(0, lastFilled + 1).map(segment => {
    const name = segment.match(/^:(\w+)/)?.[1]
    const parameter = name === undefined ? undefined : parameters.get(name)
    if (!parameter) return segment
    const text = value(parameter.name) || (parameter.optional ? parameter.default : '')
    if (text === '') missing.push(parameter.name)
    return parameter.allowsSlashes
      ? text.split('/').map(encodeURIComponent).join('/')
      : encodeURIComponent(text)
  })

  return {
    url: missing.length === 0 ? `${instance}/${[namespace, ...path].join('/')}` : null,
    missing
  }
}
