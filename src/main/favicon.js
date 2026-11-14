import { isIP } from 'node:net'
import { Readable } from 'node:stream'
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
 * @returns {Promise<string[]>} no addresses for hosts that cannot be resolved
 */
async function lookupHost(hostname, resolveAddresses) {
  const host = hostname.replaceAll(/^\[|\]$/g, '')
  try {
    return isIP(host) ? [host] : (await resolveAddresses(host)).filter(address => isIP(address))
  } catch {
    return []
  }
}

/**
 * @typedef {object} EngineNetwork
 * @property {(hostname: string) => Promise<string[]>} resolveAddresses resolves a host name to its IP addresses
 * @property {(url: string) => Promise<string>} resolveProxy the proxy for `url`, `DIRECT` for none
 * @property {(url: string, init: RequestInit, addresses: string[]) => Promise<Response>} fetchPinned
 *   connects only to `addresses` and does not follow redirects
 * @property {(url: string, init: RequestInit) => Promise<Response>} fetchProxied does not follow redirects
 */

/**
 * @typedef {object} Engine
 * @property {string} host
 * @property {Promise<boolean>} [isLocal] whether the engine is on the local network,
 *   from one lookup, so a later lookup cannot rebind it there
 */

/**
 * @param {Engine} engine
 * @param {EngineNetwork} network
 */
function isLocalEngine(engine, network) {
  // A failed lookup must not grant the exception
  engine.isLocal ??= lookupHost(engine.host, network.resolveAddresses).then(addresses => addresses.some(isNonPublicNetworkAddress))
  return engine.isLocal
}

/**
 * Requests `url` once for `engine`, or returns null when the request would reach
 * the local network. A public engine must not make the app request addresses
 * there. Self-hosted engines, such as SearXNG, keep their icons on their network.
 * @param {string} url
 * @param {RequestInit} init
 * @param {Engine} engine
 * @param {EngineNetwork} network
 * @returns {Promise<Response | null>}
 */
async function fetchEngineHop(url, init, engine, network) {
  const { hostname, protocol } = new URL(url)
  if (protocol !== 'https:' && protocol !== 'http:') return null

  const proxied = await network.resolveProxy(url) !== 'DIRECT'
  // A proxy resolves the host name itself, so its connection cannot be pinned to
  // the checked addresses, and the engine's own host needs no lookup through it.
  if (proxied && hostname === engine.host) return network.fetchProxied(url, init)
  const addresses = await lookupHost(hostname, network.resolveAddresses)
  // The first direct request, for the engine's homepage, decides without another lookup
  if (hostname === engine.host) engine.isLocal ??= Promise.resolve(addresses.some(isNonPublicNetworkAddress))
  if (addresses.length === 0 || (addresses.some(isNonPublicNetworkAddress) && !await isLocalEngine(engine, network))) return null
  // Connect only to the checked addresses, as a second lookup could rebind to the local network
  return proxied ? network.fetchProxied(url, init) : network.fetchPinned(url, init, addresses)
}

const MAX_REDIRECTS = 5

/**
 * Fetches `url` for `engine`, checking each redirect target
 * before requesting it. The returned response's `url` is the final one.
 * @param {string} url
 * @param {RequestInit} init
 * @param {Engine} engine
 * @param {EngineNetwork} network
 * @returns {Promise<Response>}
 */
async function fetchFromEngine(url, init, engine, network) {
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetchEngineHop(url, init, engine, network)
    if (!response) throw new Error('Refused a search engine request to the local network')
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || location === null) {
      return Object.defineProperty(response, 'url', { value: url })
    }
    await response.body?.cancel()
    url = new URL(location, url).href
  }
  throw new Error('Too many search engine redirects')
}

/**
 * Requests `url` once with Electron's `net.request`, which unlike `net.fetch`
 * reports a redirect without following it.
 * @param {(options: object) => import('electron').ClientRequest} request Electron's `net.request`
 * @param {string} url
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} init
 * @returns {Promise<Response>} a redirect as its status and `Location` header
 */
export function requestWithoutRedirects(request, url, { headers = {}, signal }) {
  return new Promise((resolve, reject) => {
    const clientRequest = request({ url, redirect: 'manual' })
    for (const [name, value] of Object.entries(headers)) clientRequest.setHeader(name, value)
    const abort = () => {
      clientRequest.abort()
      reject(signal?.reason)
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    clientRequest.on('redirect', (statusCode, _method, redirectUrl) => {
      clientRequest.abort()
      resolve(new Response(null, { status: statusCode, headers: { location: redirectUrl } }))
    })
    clientRequest.on('response', message => {
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(message.headers)) {
        for (const item of [value].flat()) responseHeaders.append(name, item)
      }
      const body = [204, 205, 304].includes(message.statusCode) ? null : Readable.toWeb(message)
      resolve(new Response(body, { status: message.statusCode, headers: responseHeaders }))
    })
    clientRequest.on('error', reject)
    clientRequest.end()
  })
}

/**
 * @param {string} searchUrl
 * @param {(input: string, init: RequestInit) => Promise<Response>} fetchPage
 * @returns {Promise<string>} the icon the engine's homepage declares, or its `/favicon.ico`
 */
export async function resolveFaviconUrl(searchUrl, fetchPage) {
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
    return extractFaviconUrl(new TextDecoder().decode(data), response.url || homepage) ?? fallback
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
 * @returns {Promise<string>} a data URL, or an empty string when there is no usable icon
 */
export async function fetchFaviconDataUrl(iconUrl, fetchIcon) {
  try {
    const response = await fetchIcon(iconUrl, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(5000)
    })
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!response.ok || !contentType.startsWith('image/')) return ''

    const { data, complete } = await readAtMost(response, MAX_ICON_BYTES)
    if (data.length === 0 || !complete) return ''

    return `data:${contentType};base64,${data.toString('base64')}`
  } catch {
    return ''
  }
}

/**
 * Resolves a search engine's icon as a data URL, so the renderer never requests
 * the engine's addresses itself and every request passes the local network check.
 * @param {string} searchUrl
 * @param {EngineNetwork} network
 * @returns {Promise<string>} an empty string when the engine has no usable icon
 */
export async function resolveSearchEngineIcon(searchUrl, network) {
  const fallback = getFaviconUrl(searchUrl)
  if (!fallback) return ''

  /** @type {Engine} */
  const engine = { host: new URL(fallback).hostname }
  const fetchIcon = (url, init) => fetchFromEngine(url, init, engine, network)
  for (const iconUrl of new Set([await resolveFaviconUrl(searchUrl, fetchIcon), fallback])) {
    const icon = await fetchFaviconDataUrl(iconUrl, fetchIcon)
    if (icon) return icon
  }
  return ''
}
