import { computed, watch } from 'vue'

import store from '../store/index'
import { refreshRssFeeds, rssFeedCacheCovers, rssFeedItems } from '../helpers/rssFeeds'

/**
 * The cached items of the followed RSS feeds. They load on first use, unless
 * fetching on startup is disabled and they are cached, and after feeds were
 * added in the settings.
 * @param {() => boolean} [enabled]
 */
export function useFollowedRssFeedItems(enabled = () => true) {
  /** @type {import('vue').ComputedRef<import('../helpers/rssFeeds').RssFeed[]>} */
  const feeds = computed(() => enabled() ? store.getters.getFollowedRssFeeds : [])
  const feedUrls = computed(() => new Set(feeds.value.map(feed => feed.url)))
  const feedAvatars = computed(() => new Map(feeds.value.map(feed => [feed.url, feed.avatar ?? null])))

  // Removed feeds disappear right away, without waiting for the next refresh
  const items = computed(() => rssFeedItems.value.filter(item => feedUrls.value.has(item.feedUrl)))

  watch(feeds, (value) => {
    if (value.length > 0 && !rssFeedCacheCovers(value)) {
      refreshRssFeeds(value)
    }
  }, { immediate: true })

  return { feeds, feedUrls, feedAvatars, items }
}
