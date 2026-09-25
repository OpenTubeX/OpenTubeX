import { isYtDlpMediaUrl } from '../../ytDlpArguments.js'

/**
 * URLs entered in the search bar may be handed to yt-dlp for media extraction.
 * Keep this limited to web URLs, with no embedded credentials.
 * @param {unknown} value
 */
export function isExternalMediaUrl(value) {
  return isYtDlpMediaUrl(value)
}

/**
 * Keep YouTube and the selected Invidious instance on their existing routes.
 * Other sites go straight to yt-dlp before the YouTube path parser can mistake
 * e.g. `vimeo.com/12345` for a channel.
 * @param {unknown} value
 * @param {string} invidiousInstanceUrl
 */
export function shouldOpenExternalMediaUrl(value, invidiousInstanceUrl = '') {
  if (!isExternalMediaUrl(value)) return false

  const url = new URL(value)
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com') ||
    hostname === 'youtube-nocookie.com' || hostname.endsWith('.youtube-nocookie.com') ||
    hostname === 'redirect.invidious.io') return false

  try {
    const instance = new URL(invidiousInstanceUrl)
    const instanceHost = instance.hostname.toLowerCase().replace(/\.$/, '')
    const instancePath = instance.pathname.replace(/\/$/, '')
    if (url.protocol === instance.protocol && hostname === instanceHost && url.port === instance.port &&
      (url.pathname === instancePath || url.pathname.startsWith(`${instancePath}/`))) return false
  } catch { /* No configured instance. */ }

  return true
}
