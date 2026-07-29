import { getFaviconUrl } from '../searchEngines.js'

/**
 * @param {string} tag
 * @returns {Record<string, string>}
 */
function parseAttributes(tag) {
  const attributes = {}
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
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
 * @param {string} searchUrl
 * @param {(input: string, init: RequestInit) => Promise<Response>} fetchPage
 * @returns {Promise<string>}
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

    return extractFaviconUrl(await response.text(), response.url || homepage) ?? fallback
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

    const data = Buffer.from(await response.arrayBuffer())
    if (data.length === 0 || data.length > 262_144) return iconUrl

    return `data:${contentType};base64,${data.toString('base64')}`
  } catch {
    return iconUrl
  }
}
