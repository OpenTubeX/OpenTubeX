<template>
  <SubscriptionsTabUi
    :is-loading="isLoading"
    :video-list="newMedia"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    :only-show-new="true"
    :has-additional-content="newPosts.length > 0"
    :track-global-refresh="false"
    stable-item-keys
    @refresh="refresh"
  >
    <template #before-list>
      <h3 v-if="newMedia.length > 0">
        {{ $t('Global.Videos') }}
      </h3>
    </template>
    <section
      v-if="newPosts.length > 0"
      class="postsSection"
    >
      <h3>{{ $t('Global.Posts') }}</h3>
      <FtElementList
        :data="newPosts"
        display="list"
        stable-item-keys
        :use-channels-hidden-preference="false"
      />
    </section>
    <FtPrompt
      v-if="showRefreshWarning"
      :label="$t('Subscriptions.New Feed Refresh Warning Title')"
      :extra-labels="[$t('Subscriptions.New Feed Refresh Warning', { count: activeSubscriptionIds.size })]"
      :option-names="[$t('Yes'), $t('No')]"
      :option-values="['refresh', 'cancel']"
      autosize
      @click="handleRefreshWarning"
    />
  </SubscriptionsTabUi>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtElementList from './FtElementList/FtElementList.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { isHistoryEntryWatched } from '../helpers/history'
import {
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote
} from '../helpers/subscriptions'

const { t } = useI18n()
const LARGE_SUBSCRIPTION_COUNT = 125
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

const newContent = computed(() => {
  const entries = []
  const seenIds = new Set()

  enabledFeeds.value.forEach(({ cache, entriesKey }) => {
    Object.entries(cache).forEach(([channelId, cacheEntry]) => {
      if (!activeSubscriptionIds.value.has(channelId)) {
        return
      }

      cacheEntry?.[entriesKey]?.forEach(entry => {
        if (entry.isNewInSubscriptionFeed !== true) {
          return
        }

        if (entry.videoId != null && isHistoryEntryWatched(store.getters.getHistoryCacheById[entry.videoId])) {
          return
        }

        const id = entry.videoId ?? entry.postId
        if (id == null || seenIds.has(id)) {
          return
        }

        seenIds.add(id)
        entries.push({ ...entry, hideNewSubscriptionFeedIndicator: true })
      })
    })
  })

  return entries.sort((a, b) => {
    return (b.published ?? b.publishedTime ?? 0) - (a.published ?? a.publishedTime ?? 0)
  })
})

const newMedia = computed(() => newContent.value.filter(entry => entry.videoId != null))
const newPosts = computed(() => newContent.value.filter(entry => entry.postId != null))

const isLoading = computed(() => {
  return !store.getters.getSubscriptionCacheReady || isRefreshing.value
})

const hasNewContent = computed(() => newContent.value.length > 0)

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

defineExpose({
  refresh,
  isLoading,
  lastRefreshTimestamp: '',
  nextAutoRefreshTimestamp: '',
  nextAutoRefreshTooltip: '',
  refreshTitle: computed(() => t('Subscriptions.New Content')),
  hasNewContent
})
</script>

<style scoped>
.postsSection {
  margin-block-start: 32px;
}
</style>
