export const NAVIGATION_ITEM_DEFINITIONS = Object.freeze([
  { id: 'home', labelKey: 'Home Page.Home', icon: ['fas', 'house'] },
  { id: 'subscriptions', labelKey: 'Subscriptions.Subscriptions', icon: ['fas', 'rss'] },
  { id: 'userplaylists', labelKey: 'Playlists', icon: ['fas', 'bookmark'] },
  { id: 'history', labelKey: 'History.History', icon: ['fas', 'history'] },
  { id: 'subscribedchannels', labelKey: 'Channels.Channels', icon: ['fas', 'user-check'] },
  { id: 'trending', labelKey: 'Trending.Trending', icon: ['fas', 'fire'], requiresLocalApi: true },
  { id: 'popular', labelKey: 'Most Popular', icon: ['fas', 'users'] },
  { id: 'stats', labelKey: 'Stats.Stats', icon: ['fas', 'chart-line'] },
].map(Object.freeze))

export const DEFAULT_NAVIGATION_ITEMS = Object.freeze(
  NAVIGATION_ITEM_DEFINITIONS.map(({ id }) => id)
)

const NAVIGATION_ITEM_IDS = new Set(DEFAULT_NAVIGATION_ITEMS)

/**
 * Removes unknown and duplicate entries while preserving the user's order.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeNavigationItems(value) {
  if (!Array.isArray(value)) return [...DEFAULT_NAVIGATION_ITEMS]
  return [...new Set(value.filter(id => NAVIGATION_ITEM_IDS.has(id)))]
}

/**
 * Converts the former navigation visibility switches to the ordered list.
 * @param {Record<string, unknown>} settings
 * @returns {string[]}
 */
export function navigationItemsFromLegacySettings(settings) {
  const hiddenItems = new Set([
    ...(settings.hideHome === true ? ['home'] : []),
    ...(settings.hidePlaylists === true ? ['userplaylists'] : []),
    ...(settings.hidePopularVideos === true ? ['popular'] : []),
    ...(settings.hideTrendingVideos === true ? ['trending'] : []),
  ])

  return DEFAULT_NAVIGATION_ITEMS.filter(id => !hiddenItems.has(id))
}
