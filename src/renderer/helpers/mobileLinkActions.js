import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from './share.js'

/**
 * Resolve the URL copied from the mobile long-press menu. App routes use their
 * public YouTube equivalent so the clipboard never receives a file URL.
 * @param {string} href
 * @param {string} appUrl
 * @returns {string | null}
 */
export function resolveMobileContextLinkCopyUrl(href, appUrl) {
  const internalPrefix = `${appUrl}#`
  if (!href.startsWith(internalPrefix)) {
    return href
  }

  const route = new URL(href).hash.slice(1)
  return isShareableOpenTubeXRoute(route)
    ? transformOpenTubeXRouteUrl(route, true) ?? null
    : null
}
