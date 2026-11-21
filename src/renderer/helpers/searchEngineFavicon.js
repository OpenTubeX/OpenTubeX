import { getFaviconUrl } from '../../searchEngines'

const ICON_PATHS = ['/favicon.ico', '/favicon.svg', '/favicon.png', '/apple-touch-icon.png']

/** @type {Map<string, Promise<string>>} */
const webFavicons = new Map()

/**
 * Icon URLs a site commonly serves, ending with its parent domain's
 * favicon.ico, as for search.brave.com, which declares only hashed icon URLs.
 * The parent is skipped for second-level registries such as co.uk.
 * @param {string} origin
 */
function getIconCandidates(origin) {
  const { protocol, hostname } = new URL(origin)
  const candidates = ICON_PATHS.map(path => new URL(path, origin).href)
  const parent = hostname.split('.').slice(1)
  const isRegistry = parent.length === 2 && parent[1].length === 2 && parent[0].length <= 3
  if (parent.length >= 2 && !isRegistry && !/^\d+$/.test(parent.at(-1))) {
    candidates.push(`${protocol}//${parent.join('.')}/favicon.ico`)
  }
  return candidates
}

/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function loadsAsImage(url) {
  return new Promise(resolve => {
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => resolve(image.naturalWidth > 0)
    image.onerror = () => resolve(false)
    image.src = url
  })
}

/**
 * @param {string} origin
 */
async function findWebFavicon(origin) {
  for (const candidate of getIconCandidates(origin)) {
    if (await loadsAsImage(candidate)) return candidate
  }
  return ''
}

/**
 * Electron finds the icon a search engine's page declares, as a data URL. The
 * web version cannot read other sites' pages, so it tries the paths sites
 * usually serve icons at, one at a time.
 * @param {string} searchUrl
 * @returns {Promise<string>} an empty string without a usable icon
 */
export function resolveSearchEngineFavicon(searchUrl) {
  if (process.env.IS_ELECTRON) return window.ftElectron.resolveFavicon(searchUrl)

  const fallback = getFaviconUrl(searchUrl)
  if (!fallback) return Promise.resolve('')

  const origin = new URL(fallback).origin
  if (!webFavicons.has(origin)) {
    const favicon = findWebFavicon(origin)
    webFavicons.set(origin, favicon)
    // Retry next time, after a connection problem for example
    favicon.then(icon => { if (!icon) webFavicons.delete(origin) })
  }
  return webFavicons.get(origin)
}
