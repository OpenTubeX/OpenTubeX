import { shallowReactive } from 'vue'

/** @typedef {'videos' | 'shorts' | 'live' | 'posts'} SubscriptionFeed */

/**
 * @typedef {object} SubscriptionFeedError
 * @property {string[]} reasons readable failure reasons
 * @property {string} trace technical details for bug reports
 * @property {boolean} unavailable the channel does not exist anymore or was terminated
 */

/**
 * The failed feeds of channels whose last fetch failed. Entries last for the
 * session, until a later fetch of the feed succeeds or the user dismisses them.
 * @type {Map<string, Partial<Record<SubscriptionFeed, SubscriptionFeedError>>>}
 */
export const subscriptionChannelErrors = shallowReactive(new Map())

/**
 * @param {string} channelId
 * @param {SubscriptionFeed} feed
 * @param {SubscriptionFeedError} error
 * @returns {boolean} whether the channel had no error before
 */
export function setSubscriptionChannelError(channelId, feed, error) {
  const errors = subscriptionChannelErrors.get(channelId)
  subscriptionChannelErrors.set(channelId, { ...errors, [feed]: error })
  return errors === undefined
}

/**
 * @param {string} channelId
 * @param {SubscriptionFeed[]} feeds
 */
export function clearSubscriptionChannelErrors(channelId, feeds) {
  const errors = subscriptionChannelErrors.get(channelId)
  if (!errors || !feeds.some(feed => feed in errors)) return

  const remaining = Object.fromEntries(Object.entries(errors).filter(([feed]) => !feeds.includes(feed)))
  if (Object.keys(remaining).length === 0) {
    subscriptionChannelErrors.delete(channelId)
  } else {
    subscriptionChannelErrors.set(channelId, remaining)
  }
}

/**
 * The feeds listed by each error box the user can see right now.
 * @type {Set<() => SubscriptionFeed[]>}
 */
const shownErrorBoxes = new Set()

/**
 * Registers a visible error box, so that refreshes don't notify about
 * failures the user can already see. Returns a function to unregister it.
 * @param {() => SubscriptionFeed[]} getFeeds
 */
export function registerShownSubscriptionErrorBox(getFeeds) {
  shownErrorBoxes.add(getFeeds)
  return () => shownErrorBoxes.delete(getFeeds)
}

/**
 * @param {SubscriptionFeed} feed
 */
export function isSubscriptionFeedErrorShown(feed) {
  return [...shownErrorBoxes].some(getFeeds => getFeeds().includes(feed))
}
