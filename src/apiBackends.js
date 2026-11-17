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

/**
 * The username and password of an Invidious instance behind HTTP Basic
 * authentication. They belong to the instance's address, so other instances
 * never receive them.
 * @typedef {{ instance: string, username: string, password: string }} InvidiousInstanceCredentials
 */

/** @param {string} value */
function decodeCredential(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * The address that requests to an Invidious instance go to: the URL without
 * credentials or a trailing slash, or the value as it is if it is no URL.
 * @param {string} value
 * @returns {string}
 */
export function normalizeInvidiousInstanceUrl(value) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return value
  }
}

/**
 * Splits the credentials off an instance URL such as
 * `https://user:password@invidious.example`, which older versions saved.
 * @param {unknown} value
 * @returns {{ instance: unknown, credentials: InvidiousInstanceCredentials | null }}
 * the URL without credentials, or the value as it is if it has none
 */
export function splitInvidiousInstanceCredentials(value) {
  if (typeof value !== 'string') return { instance: value, credentials: null }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return { instance: value, credentials: null }
  }
  if (url.username === '' && url.password === '') return { instance: value, credentials: null }
  // URL percent-encodes credentials, but servers compare the raw values
  const username = decodeCredential(url.username)
  const password = decodeCredential(url.password)
  const instance = normalizeInvidiousInstanceUrl(url.toString())
  return { instance, credentials: { instance, username, password } }
}

/**
 * The saved credentials if they belong to `instanceUrl`.
 * @param {unknown} credentials the invidiousInstanceCredentials setting
 * @param {string} instanceUrl a normalized instance URL
 * @returns {InvidiousInstanceCredentials | null}
 */
export function getInvidiousInstanceCredentials(credentials, instanceUrl) {
  if (credentials === null || typeof credentials !== 'object') return null
  const { instance, username, password } = /** @type {Record<string, unknown>} */ (credentials)
  if (instance !== instanceUrl || instanceUrl === '' || typeof username !== 'string' || typeof password !== 'string') return null
  return username === '' && password === '' ? null : { instance, username, password }
}
