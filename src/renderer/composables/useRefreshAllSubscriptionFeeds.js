import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../store/index'
import { refreshSubscriptionFeeds } from '../helpers/subscriptionFeedRefresh'
import { getEnabledSubscriptionFeedSources } from '../helpers/newSubscriptionFeed'
import { refreshRssFeeds, rssFeedsRefreshing } from '../helpers/rssFeeds'
import { getFollowedChannels, platformFeedRefreshing, refreshPlatformFeed } from '../helpers/platformFeed'
import { supportsYtDlp } from '../helpers/ytDlpCapabilities'

const LARGE_SUBSCRIPTION_COUNT = 125

export function useRefreshAllSubscriptionFeeds() {
  const { t } = useI18n()
  const isRefreshing = ref(false)
  const attemptedFetch = ref(false)
  const showRefreshWarning = ref(false)

  const activeSubscriptionIds = computed(() => {
    return new Set(store.getters.getActiveProfile.subscriptions.map(channel => channel.id))
  })

  const enabledFeeds = computed(() => getEnabledSubscriptionFeedSources(store.getters))

  const rssFeeds = computed(() => {
    return supportsYtDlp && store.getters.getEnableRssFeeds ? store.getters.getFollowedRssFeeds : []
  })

  function refresh() {
    if (isRefreshing.value || store.getters.getSubscriptionFeedRefreshInProgress) {
      return
    }

    // The confirmation is about the subscription feeds, not the RSS feeds or other platforms
    if (
      enabledFeeds.value.length > 0 &&
      store.getters.getConfirmRefreshAllFeeds &&
      !store.getters.getUseRssFeeds &&
      activeSubscriptionIds.value.size > LARGE_SUBSCRIPTION_COUNT
    ) {
      showRefreshWarning.value = true
      return
    }

    refreshAllFeeds()
  }

  // Also refreshes the RSS feeds and the channels followed on other platforms,
  // which run alongside the subscription feeds
  async function refreshAllFeeds() {
    // Starting another refresh would abort the running one
    if (rssFeeds.value.length > 0 && !rssFeedsRefreshing.value) {
      refreshRssFeeds(rssFeeds.value)
    }
    if (getFollowedChannels().length > 0 && !platformFeedRefreshing.value) {
      refreshPlatformFeed()
    }
    if (enabledFeeds.value.length === 0 || activeSubscriptionIds.value.size === 0) return

    isRefreshing.value = true
    attemptedFetch.value = true

    try {
      await refreshSubscriptionFeeds(enabledFeeds.value.map(feed => feed.category), { t })
    } finally {
      isRefreshing.value = false
    }
  }

  /**
   * @param {'refresh' | 'cancel' | 'neverAskAgain' | null} action
   */
  function handleRefreshWarning(action) {
    showRefreshWarning.value = false

    if (action === 'neverAskAgain') {
      store.dispatch('updateConfirmRefreshAllFeeds', false)
    }
    if (action === 'refresh' || action === 'neverAskAgain') {
      refreshAllFeeds()
    }
  }

  return {
    activeSubscriptionIds,
    attemptedFetch,
    enabledFeeds,
    handleRefreshWarning,
    isRefreshing,
    refresh,
    showRefreshWarning
  }
}
