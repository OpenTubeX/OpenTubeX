const FIXED_INTERNAL_ROUTE_TITLES = Object.freeze({
  '/home': 'Home',
  '/subscriptions': 'Subscriptions',
  '/subscribedchannels': 'Channel List',
  '/trending': 'Trending',
  '/popular': 'Most Popular',
  '/userplaylists': 'Your Playlists',
  '/history': 'History',
  '/downloads': 'Downloads',
  '/stats': 'Stats',
  '/settings': 'Settings',
  '/about': 'About',
  '/settings/profile': 'Profile Manager'
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
