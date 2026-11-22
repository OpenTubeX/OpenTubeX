import store from '../store/index'
import {
  getSubscriptionRefreshCancelCount,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
  withSharedChannelUploads
} from './subscriptions'
import { withAndroidSubscriptionRefreshBatch } from './androidSubscriptionRefresh'
import { getEnabledSubscriptionFeedSources } from './newSubscriptionFeed'

/** @typedef {'videos' | 'shorts' | 'live' | 'posts'} SubscriptionFeedCategory */

const REFRESHERS = {
  videos: refreshSubscriptionVideosFromRemote,
  shorts: refreshSubscriptionShortsFromRemote,
  live: refreshSubscriptionLiveFromRemote,
  posts: refreshSubscriptionPostsFromRemote
}

/**
 * Refreshes the feeds one after another, sharing the channels' uploads between them.
 * @param {SubscriptionFeedCategory[]} categories
 * @param {{ t: (key: string) => string, automatic?: boolean }} options
 * @param {(category: SubscriptionFeedCategory, result: unknown) => void} [onRefreshed] Called after each feed
 */
export async function refreshSubscriptionFeeds(categories, options, onRefreshed) {
  const cancelCountAtStart = getSubscriptionRefreshCancelCount()
  await withAndroidSubscriptionRefreshBatch(() => withSharedChannelUploads(async () => {
    for (const category of categories) {
      // Also covers a cancellation between two feeds, when no feed refresh
      // was running to receive it
      if (getSubscriptionRefreshCancelCount() !== cancelCountAtStart) {
        break
      }

      const result = await REFRESHERS[category](options)
      onRefreshed?.(category, result)
    }
  }), { title: options.t('Subscriptions.Subscriptions'), cancelLabel: options.t('Feed.Cancel Refresh') })
}

/**
 * Refreshes a feed and, when the user started the refresh, then the other
 * visible feeds they chose to refresh together with it.
 * @param {SubscriptionFeedCategory} category
 * @param {{ t: (key: string) => string, automatic?: boolean }} options
 * @returns {Promise<unknown>} The result of the feed's own refresh, null if it
 * didn't run. Resolves as soon as that refresh finishes, so the feed can show
 * its results while the others still refresh.
 */
export function refreshSubscriptionFeed(category, options) {
  /** @type {string[]} */
  const together = store.getters.getSubscriptionFeedsRefreshedTogether
  // Automatic refreshes follow each feed's own interval
  if (options.automatic || !together.includes(category)) {
    return REFRESHERS[category](options)
  }

  const otherFeeds = getEnabledSubscriptionFeedSources(store.getters)
    .map(feed => feed.category)
    .filter(feed => feed !== category && together.includes(feed))
  if (otherFeeds.length === 0) {
    return REFRESHERS[category](options)
  }

  return new Promise((resolve, reject) => {
    let resolved = false
    refreshSubscriptionFeeds([category, ...otherFeeds], options, (feed, result) => {
      if (feed === category) {
        resolved = true
        resolve(result)
      }
    }).then(() => resolve(null), (error) => {
      // The caller only waits for its own feed, so nothing else would see a
      // later feed's error
      if (resolved) {
        console.error(error)
      } else {
        reject(error)
      }
    })
  })
}
