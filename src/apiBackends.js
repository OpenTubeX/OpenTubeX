// @ts-check
/**
 * Invidious and Yattee servers share the Invidious-compatible API.
 * @param {string} backend
 * @returns {boolean}
 */
export function usesInvidiousApi(backend) {
  return backend === 'invidious' || backend === 'yattee'
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
