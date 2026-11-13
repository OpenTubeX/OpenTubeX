import { isIP } from 'node:net'
import { decodeHTMLAttribute } from 'entities'

import { getFaviconUrl } from '../searchEngines.js'
import { isNonPublicNetworkAddress } from './utils.js'

const MAX_ICON_BYTES = 262_144
// Icons are declared in <head>, so the start of a page is enough to find them.
const MAX_HTML_BYTES = 524_288

/**
 * @param {string} tag
 * @returns {Record<string, string>}
 */
function parseAttributes(tag) {
  const attributes = {}
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHTMLAttribute(match[2] ?? match[3] ?? match[4] ?? '')
  }

  return attributes
}

/**
 * @param {Record<string, string>} attributes
 * @returns {number}
 */
function faviconScore(attributes) {
  const type = attributes.type?.toLowerCase() ?? ''
  const sizes = attributes.sizes?.toLowerCase() ?? ''

  // Prefer the exact menu target size. Some sites serve SVG favicons with
  // response policies that prevent Electron image elements from displaying
  // them even though a browser-declared PNG is available alongside them.
  if (sizes.split(/\s+/).includes('32x32')) return 100
  if (type === 'image/svg+xml') return 90
  if (sizes.split(/\s+/).includes('16x16')) return 80
  if (type === 'image/png') return 70
  return 50
}

/**
 * Find the favicon that a browser would use, preferring scalable or small
 * raster icons over legacy ICO files.
 *
 * @param {string} html
 * @param {string} pageUrl
 * @returns {string | null}
 */
export function extractFaviconUrl(html, pageUrl) {
  const candidates = []

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const rel = new Set((attributes.rel ?? '').toLowerCase().split(/\s+/))
    if (!rel.has('icon') || !attributes.href) continue

    try {
      const url = new URL(attributes.href, pageUrl)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      candidates.push({ url: url.href, score: faviconScore(attributes) })
    } catch {
      // Ignore malformed icon declarations.
    }
  }

  return candidates.toSorted((a, b) => b.score - a.score)[0]?.url ?? null
}

/**
 * Reads at most `limit` bytes of a response body and cancels the rest.
 * @param {Response} response
 * @param {number} limit
 * @returns {Promise<{ data: Buffer, complete: boolean }>}
 */
async function readAtMost(response, limit) {
  const chunks = []
  let size = 0
  if (!response.body) return { data: Buffer.alloc(0), complete: true }

  const reader = response.body.getReader()
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      chunks.push(read.value)
      size += read.value.byteLength
      if (size > limit) {
        reader.cancel().catch(() => {})
        return { data: Buffer.concat(chunks).subarray(0, limit), complete: false }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return { data: Buffer.concat(chunks), complete: true }
}

/**
 * @param {string} hostname
 * @param {(hostname: string) => Promise<string[]>} resolveAddresses
 * @returns {Promise<boolean>} true for hosts that cannot be resolved too
 */
async function isNonPublicHost(hostname, resolveAddresses) {
  const host = hostname.replaceAll(/^\[|\]$/g, '')
  try {
    const addresses = isIP(host) ? [host] : await resolveAddresses(host)
    return addresses.length === 0 || addresses.some(isNonPublicNetworkAddress)
  } catch {
    return true
  }
}

/**
 * A public engine's page must not make the app request addresses on the local
 * network. Self-hosted engines, such as SearXNG, keep icons on their network.
 * @param {string} iconUrl
 * @param {string} pageUrl
 * @param {(hostname: string) => Promise<string[]>} resolveAddresses
 */
async function isAllowedIconUrl(iconUrl, pageUrl, resolveAddresses) {
  const iconHost = new URL(iconUrl).hostname
  const pageHost = new URL(pageUrl).hostname
  if (iconHost === pageHost) return true
  return !await isNonPublicHost(iconHost, resolveAddresses) || await isNonPublicHost(pageHost, resolveAddresses)
}

/**
 * @param {string} searchUrl
 * @param {(input: string, init: RequestInit) => Promise<Response>} fetchPage
 * @param {(hostname: string) => Promise<string[]>} resolveAddresses resolves a host name to its IP addresses
 * @returns {Promise<string>}
 */
export async function resolveFaviconUrl(searchUrl, fetchPage, resolveAddresses) {
  const fallback = getFaviconUrl(searchUrl)
  if (!fallback) return ''

  try {
    const homepage = new URL(searchUrl.replaceAll('%s', 'query')).origin
    const response = await fetchPage(homepage, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(5000)
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return fallback

    const { data } = await readAtMost(response, MAX_HTML_BYTES)
    const pageUrl = response.url || homepage
    const iconUrl = extractFaviconUrl(new TextDecoder().decode(data), pageUrl)
    return iconUrl && await isAllowedIconUrl(iconUrl, pageUrl, resolveAddresses) ? iconUrl : fallback
  } catch {
    return fallback
  }
}

/**
 * Fetch an icon in the main process so renderer image policies and cross-origin
 * response headers cannot prevent it from displaying.
 *
 * @param {string} iconUrl
 * @param {(input: string, init: RequestInit) => Promise<Response>} fetchIcon
 * @returns {Promise<string>}
 */
export async function fetchFaviconDataUrl(iconUrl, fetchIcon) {
  try {
    const response = await fetchIcon(iconUrl, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(5000)
    })
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!response.ok || !contentType.startsWith('image/')) return iconUrl

    const { data, complete } = await readAtMost(response, MAX_ICON_BYTES)
    if (data.length === 0 || !complete) return iconUrl

    return `data:${contentType};base64,${data.toString('base64')}`
  } catch {
    return iconUrl
  }
}
