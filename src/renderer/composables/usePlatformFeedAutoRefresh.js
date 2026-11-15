import { useFeedAutoRefresh } from './useFeedAutoRefresh'
import {
  getPlatformFeedAutoRefreshInterval,
  loadPlatformFeedNextAutoRefresh,
  platformFeedNextAutoRefresh,
  platformFeedRefreshing,
  refreshPlatformFeed,
  setPlatformFeedNextAutoRefresh
} from '../helpers/platformFeed'

/**
 * Refreshes the feed of the channels followed on other platforms on its
 * configured interval.
 * @param {import('vue').Ref<boolean>} dataReady Whether the settings have loaded
 */
export function usePlatformFeedAutoRefresh(dataReady) {
  return useFeedAutoRefresh(dataReady, {
    lockName: 'opentubex-platform-feed-auto-refresh',
    getInterval: getPlatformFeedAutoRefreshInterval,
    nextAutoRefresh: platformFeedNextAutoRefresh,
    loadNextAutoRefresh: loadPlatformFeedNextAutoRefresh,
    setNextAutoRefresh: setPlatformFeedNextAutoRefresh,
    refreshing: platformFeedRefreshing,
    refresh: refreshPlatformFeed
  })
}
