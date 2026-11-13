/**
 * Pages that play media in the tab's retained player: YouTube videos and media
 * of other sites that plays through yt-dlp.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isPlayerRoutePath(path) {
  return path.startsWith('/watch/') || path === '/external-media'
}

export function getPreviousBrowsingRoute(tab) {
  const previous = tab?.history[tab.historyIndex - 1]?.route
  return previous && !isPlayerRoutePath(previous.path) ? previous : null
}
