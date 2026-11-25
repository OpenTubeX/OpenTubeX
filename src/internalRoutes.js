// '/' is left out on purpose: it stands for the landing page, which users
// choose, and the app replaces it with that page's route.
const FIXED_INTERNAL_ROUTE_TITLES = Object.freeze({
  '/home': 'Home',
  '/subscriptions': 'Subscriptions',
  '/subscribedchannels': 'Channel List',
  '/trending': 'Trending',
  '/popular': 'Most Popular',
  '/userplaylists': 'Your Playlists',
  '/history': 'History',
  '/stats': 'Stats',
  '/twitch': 'Twitch'
})

/**
 * Returns the title used while a fixed internal route is loading.
 * Parameterized routes intentionally keep their URL as the placeholder.
 *
 * @param {string} path
 * @returns {string | null}
 */
export function getFixedInternalRouteTitle(path) {
  return FIXED_INTERNAL_ROUTE_TITLES[path] ?? null
}

/**
 * Returns the title a route's page will show when the route alone determines
 * it, so background tabs that stay unloaded don't keep their URL as the title.
 *
 * @param {string} path the encoded route path
 * @returns {string | null}
 */
export function getRouteDerivedTitle(path) {
  const match = /^\/(search|hashtag)\/([^/]+)$/.exec(path)
  if (!match) return null
  try {
    const value = decodeURIComponent(match[2]).trim()
    if (!value) return null
    // Like the hashtag page, which decodes the router's already decoded
    // parameter again, since YouTube links reach it encoded twice. Its
    // pages only exist in lowercase.
    return match[1] === 'hashtag' ? `#${decodeURIComponent(value).toLowerCase()}` : value
  } catch {
    return null
  }
}
