// @ts-check
/**
 * Invidious and Yattee servers share the Invidious-compatible API.
 * @param {string} backend
 * @returns {boolean}
 */
export function usesInvidiousApi(backend) {
  return backend === 'invidious' || backend === 'yattee'
}

/** @typedef {'local' | 'invidious'} Api The local API, or the Invidious-compatible API of an Invidious instance or Yattee server */

/**
 * The APIs to request data from, in order: the preferred one and, if the user
 * allows falling back, the other one. Builds without the local API use only
 * the Invidious-compatible API.
 * @param {string} backend the backendPreference setting
 * @param {boolean} fallback the backendFallback setting
 * @param {boolean} [supportsLocalApi]
 * @returns {Api[]}
 */
export function getApiOrder(backend, fallback, supportsLocalApi = !!process.env.SUPPORTS_LOCAL_API) {
  if (!supportsLocalApi) return ['invidious']
  /** @type {Api[]} */
  const order = usesInvidiousApi(backend) ? ['invidious', 'local'] : ['local', 'invidious']
  return fallback ? order : order.slice(0, 1)
}

/**
 * Whether an Invidious instance serves requests as the preferred or fallback backend.
 * @param {string} backend
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function usesInvidiousInstance(backend, fallback) {
  return backend === 'invidious' || (fallback && backend === 'local')
}

/**
 * @param {unknown} value
 * @returns {string} the server URL without credentials or a trailing slash, or an empty string if it is invalid
 */
export function normalizeYatteeServerUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''

  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}
