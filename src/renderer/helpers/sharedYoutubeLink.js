import Autolinker from 'autolinker'

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'])

/** Extract a YouTube URL from a share that may also contain a video title. */
export function extractSharedYoutubeLink(text) {
  if (typeof text !== 'string') return null
  const matches = Autolinker.parse(text, { email: false, phone: false })
  for (const match of matches) {
    if (match.getType() !== 'url') continue
    const href = match.getUrl()
    let url
    try {
      url = new URL(href)
    } catch {
      continue
    }
    if (url.hostname === 'youtu.be' && !/^\/[\w-]{11}\/?$/.test(url.pathname)) continue
    if (['https:', 'http:'].includes(url.protocol) && YOUTUBE_HOSTS.has(url.hostname) && !url.username && !url.password) {
      return href
    }
  }
  return null
}
