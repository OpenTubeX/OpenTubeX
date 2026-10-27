// A googlevideo node can stop responding, for example an ISP-hosted cache.
// Like YouTube's player, switch to the backup server named in the URL.
export const GOOGLEVIDEO_CONNECTION_TIMEOUT_MS = 5_000

/** Nodes that didn't respond during this session */
const unreachableHosts = new Set()

/** Skips the assigned node, for example a cache that is often slow but still responds */
let alwaysUseBackupServer = false

/** @param {boolean} value */
export function setAlwaysUseGoogleVideoBackupServer(value) {
  alwaysUseBackupServer = value
}

/**
 * @param {URL} url
 * @param {string} name
 */
function getStreamParameter(url, name) {
  const value = url.searchParams.get(name)
  if (value !== null) return value

  // HLS segment URLs carry their parameters as path segments
  const segments = url.pathname.split('/')
  const index = segments.indexOf(name, 1)
  return index > 0 && index < segments.length - 1 ? segments[index + 1].replaceAll(/%2C/gi, ',') : null
}

/**
 * @param {string | URL} url
 * @returns {string | null} the URL on the backup server, or null when the URL has none
 */
export function getGoogleVideoFallbackUrl(url) {
  const fallbackUrl = new URL(url)
  if (!fallbackUrl.hostname.endsWith('.googlevideo.com')) return null

  const server = getStreamParameter(fallbackUrl, 'mn')?.split(',')[1]
  const fvip = getStreamParameter(fallbackUrl, 'fvip')
  if (!server || !/^sn-[\da-z-]+$/.test(server) || !fvip || !/^\d+$/.test(fvip)) return null

  const hostname = `rr${fvip}---${server}.googlevideo.com`
  if (fallbackUrl.hostname === hostname) return null

  fallbackUrl.hostname = hostname
  return fallbackUrl.toString()
}

/** @param {string | URL} url */
export function markGoogleVideoHostUnreachable(url) {
  const { hostname } = new URL(url)
  if (unreachableHosts.has(hostname) || getGoogleVideoFallbackUrl(url) === null) return

  unreachableHosts.add(hostname)
  console.warn(`Switching to the backup server because ${hostname} did not respond`)
}

/**
 * @param {string} url
 * @returns {string} the URL on the backup server if its node didn't respond before or the user always wants it
 */
export function avoidUnreachableGoogleVideoHost(url) {
  if (!alwaysUseBackupServer && (unreachableHosts.size === 0 || !unreachableHosts.has(new URL(url).hostname))) return url

  return getGoogleVideoFallbackUrl(url) ?? url
}

/**
 * Fetches a googlevideo URL, switching to the backup server when its node doesn't respond.
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchGoogleVideo(url, init = {}, fetchImpl = fetch) {
  url = avoidUnreachableGoogleVideoHost(url)
  if (getGoogleVideoFallbackUrl(url) === null) return fetchImpl(url, init)

  const connection = new AbortController()
  const timer = setTimeout(() => connection.abort(), GOOGLEVIDEO_CONNECTION_TIMEOUT_MS)
  let response
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, connection.signal]) : connection.signal
    })
  } catch (error) {
    if (init.signal?.aborted) throw error
  } finally {
    clearTimeout(timer)
  }

  // Android's native proxy answers a connection failure with 502
  if (response !== undefined && response.status !== 502) return response

  await response?.body?.cancel().catch(() => {})
  markGoogleVideoHostUnreachable(url)
  return await fetchImpl(avoidUnreachableGoogleVideoHost(url), init)
}
