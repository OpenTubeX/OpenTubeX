import store from '../store/index'
import { getSyncTabRoute } from '../helpers/sync-sessions'
import { getExternalMediaPlatformIcon, getExternalMediaUrl } from './tabPageIcon'

export { getTabPageIcon } from './tabPageIcon'

export function getSyncedTabPreview(tab) {
  try {
    const url = new URL(getSyncTabRoute(tab.url), window.location.origin)
    return { ...tab, route: { path: url.pathname, fullPath: `${url.pathname}${url.search}${url.hash}` } }
  } catch {
    return tab
  }
}

/**
 * Resolve the fallback preview image for a tab when no screenshot has been
 * captured yet. Channel and video tabs use cached creator pictures; other
 * external-media sites use the site's conventional favicon.
 * @param {{ route?: { path?: string, fullPath?: string, query?: { url?: string } }, url?: string }} tab
 * @returns {string | null}
 */
export function getTabPreviewFallbackUrl(tab) {
  return getTabAvatarUrl(tab)
}

export function getTabAvatarUrl(tab) {
  if (tab?.avatarUrl) return tab.avatarUrl

  const path = tab?.route?.path ?? ''
  const channelId = path.match(/^\/channel\/([^/]+)/)?.[1]
  if (channelId) return store.getters.getChannelThumbnail(channelId)

  const videoId = path.match(/^\/watch\/([^/]+)/)?.[1]
  if (videoId) return store.getters.getVideoAvatar(videoId)

  if (/^\/external-media(?:\/|$)/.test(path) && !getExternalMediaPlatformIcon(tab)) {
    const mediaUrl = getExternalMediaUrl(tab)
    if (mediaUrl) return new URL('/favicon.ico', mediaUrl).href
  }

  return null
}
