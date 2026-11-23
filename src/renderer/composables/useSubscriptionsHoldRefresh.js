import i18n from '../i18n/index'
import store from '../store/index'
import { refreshSubscriptionFeed } from '../helpers/subscriptionFeedRefresh'
import { refreshRssFeeds, rssFeedsRefreshing } from '../helpers/rssFeeds'
import { getFollowedChannels, platformFeedRefreshing, refreshPlatformFeed } from '../helpers/platformFeed'
import { SUBSCRIPTIONS_CURRENT_TAB_STORAGE_KEY } from '../helpers/subscriptionTabs'
import { useRefreshAllSubscriptionFeeds } from './useRefreshAllSubscriptionFeeds'
import { useVisibleSubscriptionTabs } from './useVisibleSubscriptionTabs'

const TAB_FEEDS = { videos: 'videos', shorts: 'shorts', live: 'live', community: 'posts' }

/** @param {unknown} error */
function logRefreshError(error) {
  console.error('Failed to refresh the subscriptions', error)
}

/**
 * Refreshes the feed that the subscriptions page opens to, like its Refresh
 * button, without opening the page. Its feeds pick up the results from the
 * cache. Loaded on demand, as the feed refreshes are large.
 */
export function useSubscriptionsHoldRefresh() {
  const visibleTabs = useVisibleSubscriptionTabs()
  const refreshAllFeeds = useRefreshAllSubscriptionFeeds()

  function refresh() {
    const savedTab = localStorage.getItem(SUBSCRIPTIONS_CURRENT_TAB_STORAGE_KEY)
    const tab = visibleTabs.value.includes(savedTab) ? savedTab : visibleTabs.value[0]

    if (tab === 'new') {
      refreshAllFeeds.refresh()
    } else if (tab === 'feeds') {
      // Starting another refresh would abort the running one
      const feeds = store.getters.getFollowedRssFeeds
      if (feeds.length > 0 && !rssFeedsRefreshing.value) refreshRssFeeds(feeds).catch(logRefreshError)
    } else if (tab === 'platforms') {
      if (getFollowedChannels().length > 0 && !platformFeedRefreshing.value) refreshPlatformFeed().catch(logRefreshError)
    } else if (
      tab in TAB_FEEDS &&
      !store.getters.getSubscriptionFeedRefreshInProgress &&
      store.getters.getActiveProfile.subscriptions.length > 0
    ) {
      refreshSubscriptionFeed(TAB_FEEDS[tab], { t: i18n.global.t }).catch(logRefreshError)
    }
  }

  return {
    activeSubscriptionIds: refreshAllFeeds.activeSubscriptionIds,
    handleRefreshWarning: refreshAllFeeds.handleRefreshWarning,
    refresh,
    showRefreshWarning: refreshAllFeeds.showRefreshWarning
  }
}
