import store from '../store/index'
import { useFeedAutoRefresh } from './useFeedAutoRefresh'
import {
  getRssFeedsAutoRefreshInterval,
  loadRssFeedsNextAutoRefresh,
  refreshRssFeeds,
  rssFeedsNextAutoRefresh,
  rssFeedsRefreshing,
  setRssFeedsNextAutoRefresh
} from '../helpers/rssFeeds'

/**
 * Refreshes the followed RSS feeds on their configured interval.
 * @param {import('vue').Ref<boolean>} dataReady Whether the settings have loaded
 */
export function useRssFeedAutoRefresh(dataReady) {
  return useFeedAutoRefresh(dataReady, {
    lockName: 'opentubex-rss-feeds-auto-refresh',
    getInterval: getRssFeedsAutoRefreshInterval,
    nextAutoRefresh: rssFeedsNextAutoRefresh,
    loadNextAutoRefresh: loadRssFeedsNextAutoRefresh,
    setNextAutoRefresh: setRssFeedsNextAutoRefresh,
    refreshing: rssFeedsRefreshing,
    refresh: () => refreshRssFeeds(store.getters.getFollowedRssFeeds, { automatic: true })
  })
}
