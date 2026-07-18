import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../store/index'
import {
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote
} from '../helpers/subscriptions'

const LARGE_SUBSCRIPTION_COUNT = 125

export function useRefreshAllSubscriptionFeeds() {
  const { t } = useI18n()
  const isRefreshing = ref(false)
  const attemptedFetch = ref(false)
  const errorChannels = ref([])
  const showRefreshWarning = ref(false)

  const activeSubscriptionIds = computed(() => {
    return new Set(store.getters.getActiveProfile.subscriptions.map(channel => channel.id))
  })

  const enabledFeeds = computed(() => {
    const feeds = []

    if (!store.getters.getHideSubscriptionsVideos) {
      feeds.push({ cache: store.getters.getVideoCache, entriesKey: 'videos', refresh: refreshSubscriptionVideosFromRemote })
    }
    if (!store.getters.getHideSubscriptionsShorts) {
      feeds.push({ cache: store.getters.getShortsCache, entriesKey: 'videos', refresh: refreshSubscriptionShortsFromRemote })
    }
    if (!store.getters.getHideLiveStreams && !store.getters.getHideSubscriptionsLive) {
      feeds.push({ cache: store.getters.getLiveCache, entriesKey: 'videos', refresh: refreshSubscriptionLiveFromRemote })
    }
    if (!store.getters.getHideSubscriptionsCommunity && !store.getters.getUseRssFeeds) {
      feeds.push({ cache: store.getters.getPostsCache, entriesKey: 'posts', refresh: refreshSubscriptionPostsFromRemote })
    }

    return feeds
  })

  function refresh() {
    if (isRefreshing.value || store.getters.getSubscriptionFeedRefreshInProgress) {
      return
    }

    if (!store.getters.getUseRssFeeds && activeSubscriptionIds.value.size > LARGE_SUBSCRIPTION_COUNT) {
      showRefreshWarning.value = true
      return
    }

    refreshAllFeeds()
  }

  async function refreshAllFeeds() {
    isRefreshing.value = true
    attemptedFetch.value = true
    errorChannels.value = []

    try {
      for (const feed of enabledFeeds.value) {
        await feed.refresh({ t, errorChannels: errorChannels.value })
      }
    } finally {
      isRefreshing.value = false
    }
  }

  function handleRefreshWarning(action) {
    showRefreshWarning.value = false

    if (action === 'refresh') {
      refreshAllFeeds()
    }
  }

  return {
    activeSubscriptionIds,
    attemptedFetch,
    enabledFeeds,
    errorChannels,
    handleRefreshWarning,
    isRefreshing,
    refresh,
    showRefreshWarning
  }
}
