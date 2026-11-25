// @ts-check

/**
 * Whether a URL hostname belongs to YouTube, the links main opens directly
 * and the renderer keeps on its YouTube routes. Both must agree on it.
 * @param {string} hostname
 */
export function isYouTubeHostname(hostname) {
  hostname = hostname.toLowerCase().replace(/\.$/, '')
  return hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com') ||
    hostname === 'youtube-nocookie.com' || hostname.endsWith('.youtube-nocookie.com')
}
