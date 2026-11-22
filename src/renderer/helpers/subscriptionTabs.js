// @ts-check

/** @typedef {'videos' | 'shorts' | 'live' | 'community' | 'new' | 'platforms' | 'feeds'} SubscriptionTabId */

export const SUBSCRIPTION_TAB_DEFINITIONS = Object.freeze([
  { id: 'videos', labelKey: 'Global.Videos', icon: ['fa', 'video'] },
  { id: 'shorts', labelKey: 'Global.Shorts', icon: ['fa', 'clapperboard'] },
  { id: 'live', labelKey: 'Global.Live', icon: ['fa', 'tower-broadcast'] },
  { id: 'community', labelKey: 'Global.Posts', icon: ['fa', 'message'] },
  { id: 'new', labelKey: 'Global.New', icon: ['fa', 'fire'] },
  { id: 'platforms', labelKey: 'Subscriptions.Platforms.Tab', icon: ['fas', 'globe'] },
  { id: 'feeds', labelKey: 'Subscriptions.RSS Feeds.Tab', icon: ['fas', 'rss'] },
])

/** @type {readonly SubscriptionTabId[]} */
export const DEFAULT_SUBSCRIPTION_TABS = Object.freeze(SUBSCRIPTION_TAB_DEFINITIONS.map(({ id }) => /** @type {SubscriptionTabId} */ (id)))
const TAB_IDS = new Set(DEFAULT_SUBSCRIPTION_TABS)

/**
 * Keeps the saved order of the known tabs and appends missing ones, so every
 * tab can be shown.
 * @param {unknown} value
 * @returns {SubscriptionTabId[]}
 */
export function normalizeSubscriptionTabs(value) {
  const saved = /** @type {SubscriptionTabId[]} */ (Array.isArray(value) ? value.filter(id => TAB_IDS.has(id)) : [])
  return [...new Set([...saved, ...DEFAULT_SUBSCRIPTION_TABS])]
}

/**
 * The tabs the subscriptions page shows, in the saved order.
 * @param {unknown} order
 * @param {{
 *   hideVideos: boolean,
 *   hideShorts: boolean,
 *   hideLive: boolean,
 *   hideCommunity: boolean,
 *   showNewFeed: boolean,
 *   enableRssFeeds: boolean,
 *   hasFollowedChannels: boolean,
 * }} options
 * @returns {SubscriptionTabId[]}
 */
export function getVisibleSubscriptionTabs(order, options) {
  const hasSubscriptionTabs = !options.hideVideos || !options.hideShorts || !options.hideLive || !options.hideCommunity
  /** @type {Record<SubscriptionTabId, boolean>} */
  const visible = {
    videos: !options.hideVideos,
    shorts: !options.hideShorts,
    live: !options.hideLive,
    community: !options.hideCommunity,
    // The New feed lists the new RSS and platform items too
    new: options.showNewFeed && (hasSubscriptionTabs || options.enableRssFeeds || options.hasFollowedChannels),
    platforms: options.hasFollowedChannels,
    feeds: options.enableRssFeeds,
  }
  return normalizeSubscriptionTabs(order).filter(id => visible[id])
}
