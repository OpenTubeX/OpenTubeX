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
 * Whether each error box the user can see right now lists a channel's error in a feed.
 * @type {Set<(feed: SubscriptionFeed, channelId: string) => boolean>}
 */
const shownErrorBoxes = new Set()

/**
 * Registers a visible error box, so that refreshes don't notify about
 * failures the user can already see. Returns a function to unregister it.
 * @param {(feed: SubscriptionFeed, channelId: string) => boolean} listsError
 */
export function registerShownSubscriptionErrorBox(listsError) {
  shownErrorBoxes.add(listsError)
  return () => shownErrorBoxes.delete(listsError)
}

/**
 * @param {SubscriptionFeed} feed
 * @param {string} channelId
 */
export function isSubscriptionChannelErrorShown(feed, channelId) {
  return [...shownErrorBoxes].some(listsError => listsError(feed, channelId))
}
