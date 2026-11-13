import { CapacitorHttp, registerPlugin } from '@capacitor/core'

import { isReadOnlyRequest, withNetworkRecovery } from '../networkRecovery.js'
import { createAbortError } from './requestErrors.js'
import { BROKEN_CONNECTION_ERROR } from './requestDiagnostics.js'
import { waitForRequest } from './requestWait.js'
import { ensureAndroidLocalNetworkAccess } from '../androidLocalNetwork.js'

export const DESKTOP_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const YOUTUBE_AVATAR_HOSTS = new Set([
  'yt3.ggpht.com',
  'yt4.ggpht.com',
  'yt3.googleusercontent.com'
])
const AVATAR_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const MAX_AVATAR_BASE64_LENGTH = Math.ceil(MAX_AVATAR_BYTES / 3) * 4
const AVATAR_TIMEOUT_MS = 3000
const DNS_RETRY_DELAYS_MS = [150, 500]
const DEFAULT_NATIVE_TIMEOUT_MS = 30_000
// Capacitor's HTTP plugin cannot cancel requests, so both platforms use
// plugins that close the native connection when a request is aborted.
const AbortableHttp = process.env.IS_IOS
  ? registerPlugin('IOSHttp')
  : process.env.IS_CAPACITOR ? registerPlugin('AndroidHttp') : null
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function waitForRetry(delay, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, delay))
  if (signal.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delay)
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function requestWithRetry(options, signal, readOnly) {
  let dnsRetries = 0
  let brokenConnectionRetried = false
  for (;;) {
    try {
      if (signal?.aborted) throw createAbortError()
      if (AbortableHttp) {
        const requestId = crypto.randomUUID()
        return await waitForRequest(AbortableHttp.request({ ...options, requestId }), signal,
          () => { AbortableHttp.abort({ requestId }).catch(() => {}) })
      }
      return await waitForRequest(CapacitorHttp.request(options), signal)
    } catch (error) {
      if (signal?.aborted) throw error
      // Android's HttpURLConnection does not retry a request whose kept-alive
      // connection was already closed. Open a new one at once, like browsers.
      if (readOnly && !brokenConnectionRetried && BROKEN_CONNECTION_ERROR.test(error?.message)) {
        brokenConnectionRetried = true
        continue
      }
      if (error?.code !== 'UnknownHostException' || dnsRetries >= DNS_RETRY_DELAYS_MS.length) {
        throw error
      }
      await waitForRetry(DNS_RETRY_DELAYS_MS[dnsRetries++], signal)
    }
  }
}

/**
 * @param {RequestInfo | URL} input
 * @param {RequestInit | undefined} init
 */
async function getRequestBody(input, init) {
  if (init?.body != null) {
    if (typeof init.body === 'string') return init.body
    if (init.body instanceof URLSearchParams) return init.body.toString()

    throw new TypeError('Capacitor local API requests only support text request bodies')
  }

  if (input instanceof Request && input.body !== null) {
    return await input.clone().text()
  }

  return undefined
}

/**
 * Uses Capacitor's native HTTP client for small HTML and JSON requests that
 * cannot rely on WebView CORS access. Media requests must keep using the
 * WebView so their response bodies are streamed instead of copied through the
 * JavaScript bridge as base64. nativeTimeoutMs bounds connection and read
 * inactivity on Android, defaulting to 30 seconds so stalled requests release
 * the subscription queue. signal also cancels the native request.
 * @param {RequestInfo | URL} input
 * @param {RequestInit & { nativeTimeoutMs?: number, allowHttp?: boolean, responseType?: 'arraybuffer' }} [init]
 * @returns {Promise<Response>}
 */
export async function capacitorHttpFetch(input, init = undefined) {
  // Native HTTP keeps no response cache, so every response comes from the network.
  return await withNetworkRecovery(input, init, signal => nativeHttpFetch(input, { ...init, signal }), { uncached: true })
}

async function nativeHttpFetch(input, init) {
  const inputRequest = input instanceof Request ? input : null
  const signal = init?.signal ?? inputRequest?.signal
  if (signal?.aborted) throw createAbortError()

  let url = new URL(inputRequest?.url ?? input.toString())

  if (url.protocol !== 'https:' && !(init?.allowHttp && url.protocol === 'http:')) {
    throw new TypeError('Capacitor local API requests require HTTPS')
  }

  const headers = new Headers(inputRequest?.headers)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  if (!headers.has('user-agent')) {
    headers.set('user-agent', DESKTOP_USER_AGENT)
  }

  const redirect = init?.redirect ?? inputRequest?.redirect ?? 'follow'
  const isAndroid = process.env.IS_CAPACITOR && !process.env.IS_IOS
  const options = {
    url: url.toString(),
    method: init?.method ?? inputRequest?.method ?? 'GET',
    headers: Object.fromEntries(headers),
    data: await getRequestBody(input, init),
    responseType: init?.responseType ?? 'text',
    // Native automatic redirects would skip the checks below on later hops
    disableRedirects: true,
    connectTimeout: init?.nativeTimeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS,
    readTimeout: init?.nativeTimeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS,
  }
  let nativeResponse
  let redirects = 0
  for (;;) {
    if (isAndroid) {
      await waitForRequest(ensureAndroidLocalNetworkAccess({ url: url.toString() }), signal)
      if (signal?.aborted) throw createAbortError()
    }
    nativeResponse = await requestWithRetry({ ...options, url: url.toString(), headers: Object.fromEntries(headers) }, signal,
      isReadOnlyRequest(url, options.method))
    if (!REDIRECT_STATUSES.has(nativeResponse.status)) break
    if (redirect === 'error') throw new TypeError('Redirects are not allowed for this request')
    if (redirect !== 'follow') break
    const location = new Headers(nativeResponse.headers).get('location')
    if (location === null) break
    if (redirects++ >= 20) throw new TypeError('Too many redirects')
    const target = new URL(location, url)
    if (target.protocol !== 'https:' && !(init?.allowHttp && target.protocol === 'http:')) {
      throw new TypeError('Capacitor local API requests require HTTPS')
    }
    if (target.username || target.password) throw new TypeError('Redirect URLs must not contain credentials')
    const method = options.method.toUpperCase()
    if (([301, 302].includes(nativeResponse.status) && method === 'POST') ||
        (nativeResponse.status === 303 && method !== 'GET' && method !== 'HEAD')) {
      options.method = 'GET'
      options.data = undefined
      for (const name of ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length']) headers.delete(name)
    }
    if (target.origin !== url.origin) {
      for (const name of ['authorization', 'proxy-authorization', 'cookie', 'cookie2', 'host']) headers.delete(name)
    }
    url = target
  }

  const responseBody = nativeResponse.status === 204 || nativeResponse.status === 205 || nativeResponse.status === 304
    ? null
    : init?.responseType === 'arraybuffer' && typeof nativeResponse.data === 'string'
      ? Uint8Array.from(atob(nativeResponse.data), character => character.charCodeAt(0))
      : typeof nativeResponse.data === 'string'
        ? nativeResponse.data
        : JSON.stringify(nativeResponse.data)

  const response = new Response(responseBody, {
    status: nativeResponse.status,
    headers: nativeResponse.headers,
  })

  Object.defineProperty(response, 'url', { value: nativeResponse.url })
  Object.defineProperty(response, 'redirected', { value: redirects > 0 })
  return response
}

/**
 * @param {string} src
 * @param {string} invidiousInstance
 * @returns {URL | null}
 */
function getRecoverableImageUrl(src, invidiousInstance) {
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:') return null
    if (!YOUTUBE_AVATAR_HOSTS.has(url.hostname)) {
      const instance = new URL(invidiousInstance)
      const proxyPath = `${instance.pathname.replace(/\/$/, '')}/ggpht/`
      if (url.origin !== instance.origin || !url.pathname.startsWith(proxyPath)) return null
    }

    // YouTube serves the same avatar paths from both numbered CDN hosts. Some
    // Android DNS blocklists sinkhole yt4 while leaving the canonical yt3 host
    // available, so use yt3 for the native fallback request.
    if (url.hostname === 'yt4.ggpht.com') url.hostname = 'yt3.ggpht.com'
    return url
  } catch {
    return null
  }
}

/**
 * Fetches small YouTube images through Android's native client when WebView
 * blocks the response. Proxied images stay on the selected Invidious instance.
 * @param {string} src
 * @param {string} [invidiousInstance]
 * @param {string | null} [invidiousAuthorization]
 * @returns {Promise<string | null>}
 */
export async function fetchCapacitorAvatarDataUrl(src, invidiousInstance = '', invidiousAuthorization = null) {
  const url = getRecoverableImageUrl(src, invidiousInstance)
  if (url === null) return null
  const isProxy = !YOUTUBE_AVATAR_HOSTS.has(url.hostname)

  let response
  try {
    response = await CapacitorHttp.request({
      url: url.toString(),
      method: 'GET',
      responseType: 'blob',
      headers: isProxy && invidiousAuthorization ? { Authorization: invidiousAuthorization } : undefined,
      disableRedirects: isProxy,
      connectTimeout: AVATAR_TIMEOUT_MS,
      readTimeout: AVATAR_TIMEOUT_MS
    })
  } catch {
    return null
  }

  const responseUrl = getRecoverableImageUrl(response.url, invidiousInstance)
  const headers = new Headers(response.headers)
  const mimeType = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  const contentLength = Number(headers.get('content-length'))

  if (
    responseUrl === null ||
    response.status < 200 || response.status >= 300 ||
    !AVATAR_MIME_TYPES.has(mimeType) ||
    typeof response.data !== 'string' || response.data.length === 0 ||
    response.data.length > MAX_AVATAR_BASE64_LENGTH ||
    (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES)
  ) {
    return null
  }

  return `data:${mimeType};base64,${response.data}`
}
