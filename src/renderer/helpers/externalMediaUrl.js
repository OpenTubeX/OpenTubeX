/**
 * URLs entered in the search bar may be handed to yt-dlp for media extraction.
 * Keep this limited to web URLs, with no embedded credentials.
 * @param {unknown} value
 */
export function isExternalMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return false

  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
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

  const hostname = new URL(value).hostname.toLowerCase()
  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com') ||
    hostname === 'youtube-nocookie.com' || hostname.endsWith('.youtube-nocookie.com') ||
    hostname === 'redirect.invidious.io') return false

  try {
    if (hostname === new URL(invidiousInstanceUrl).hostname.toLowerCase()) return false
  } catch { /* No configured instance. */ }

  return true
}
