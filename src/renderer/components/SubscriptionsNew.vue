<template>
  <SubscriptionsTabUi
    ref="tabUi"
    class="newFeed"
    :is-loading="isLoading"
    :video-list="newVideos"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    :only-show-new="true"
    :has-additional-content="hasAdditionalContent"
    :track-global-refresh="false"
    stable-item-keys
    @refresh="refresh"
  >
    <template #before-list="{ hasVisibleContent }">
      <h3 v-if="hasVisibleContent">
        {{ $t('Global.Videos') }}
      </h3>
    </template>
    <Transition name="new-feed-section">
      <section
        v-if="newShorts.length > 0"
        class="mediaSection"
      >
        <h3>{{ $t('Global.Shorts') }}</h3>
        <FtElementList
          :data="newShorts"
          stable-item-keys
          :youtube-style-shorts="useCustomShortsPlayer"
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <Transition name="new-feed-section">
      <section
        v-if="newLive.length > 0"
        class="mediaSection"
      >
        <h3>{{ $t('Global.Live') }}</h3>
        <FtElementList
          :data="newLive"
          stable-item-keys
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <Transition name="new-feed-section">
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
    </Transition>
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
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtElementList from './FtElementList/FtElementList.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useRefreshAllSubscriptionFeeds } from '../composables/useRefreshAllSubscriptionFeeds'
import { isHistoryEntryWatched } from '../helpers/history'
import { isVideoHiddenByPreferences } from '../helpers/subscriptions'

const { t } = useI18n()
const tabUi = useTemplateRef('tabUi')
const {
  activeSubscriptionIds,
  attemptedFetch,
  enabledFeeds,
  errorChannels,
  handleRefreshWarning,
  isRefreshing,
  refresh,
  showRefreshWarning
} = useRefreshAllSubscriptionFeeds()

const newContentByCategory = computed(() => {
  const entries = {
    videos: [],
    shorts: [],
    live: [],
    posts: []
  }
  const seenIds = new Set()

  enabledFeeds.value.forEach(({ category, cache, entriesKey }) => {
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
        entries[category].push({
          ...entry,
          hideNewSubscriptionFeedIndicator: true,
          isInNewSubscriptionFeed: true
        })
      })
    })
  })

  Object.values(entries).forEach(categoryEntries => {
    categoryEntries.sort((a, b) => {
      return (b.published ?? b.publishedTime ?? 0) - (a.published ?? a.publishedTime ?? 0)
    })
  })

  return entries
})

const forbiddenTitles = computed(() => store.getters.getForbiddenTitlesParsed)
const newMediaByCategory = computed(() => {
  let mediaEntries = ['videos', 'shorts', 'live'].flatMap(category => {
    return newContentByCategory.value[category].map(entry => ({ category, entry }))
  })

  mediaEntries = mediaEntries.filter(({ entry }) => !isVideoHiddenByPreferences(entry, {
    hideLiveStreams: store.getters.getHideLiveStreams,
    hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
    forbiddenTitles: forbiddenTitles.value
  }))

  mediaEntries.sort((a, b) => {
    return (b.entry.published ?? b.entry.publishedTime ?? 0) -
      (a.entry.published ?? a.entry.publishedTime ?? 0)
  })

  if (store.getters.getOnlyShowLatestFromChannel) {
    const authorCounts = new Map()
    const limit = store.getters.getOnlyShowLatestFromChannelNumber

    mediaEntries = mediaEntries.filter(({ entry }) => {
      if (!entry.videoId || !entry.authorId) {
        return true
      }

      const count = authorCounts.get(entry.authorId) ?? 0
      if (count >= limit) {
        return false
      }

      authorCounts.set(entry.authorId, count + 1)
      return true
    })
  }

  return mediaEntries.reduce((entries, { category, entry }) => {
    entries[category].push(entry)
    return entries
  }, {
    videos: [],
    shorts: [],
    live: []
  })
})

const newVideos = computed(() => newMediaByCategory.value.videos)
const newShorts = computed(() => newMediaByCategory.value.shorts)
const newLive = computed(() => newMediaByCategory.value.live)
const newPosts = computed(() => newContentByCategory.value.posts.filter(entry => {
  const lowerCaseAuthor = entry.author?.toLowerCase()

  return entry.postId != null &&
    !forbiddenTitles.value.some(text => lowerCaseAuthor?.includes(text))
}))
const useCustomShortsPlayer = computed(() => store.getters.getUseCustomShortsPlayer)

const hasAdditionalContent = computed(() => {
  return newShorts.value.length > 0 || newLive.value.length > 0 || newPosts.value.length > 0
})

const isLoading = computed(() => {
  return !store.getters.getSubscriptionCacheReady || isRefreshing.value
})

const hasNewContent = computed(() => {
  return hasAdditionalContent.value || tabUi.value?.hasNewContent === true
})

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
.mediaSection,
.postsSection {
  margin-block-start: 8px;
}

.mediaSection h3,
.postsSection h3 {
  margin-block-start: 0;
}

.newFeed :deep(.autoGrid) {
  position: relative;
}

.newFeed :deep(.feed-leave-active) {
  position: absolute;
  top: var(--feed-leave-top);
  left: var(--feed-leave-left);
  z-index: 1;
  width: var(--feed-leave-width);
  height: var(--feed-leave-height);
  pointer-events: none;
  transition: opacity 200ms ease;
}

.newFeed :deep(.feed-leave-to) {
  opacity: 0;
}

.new-feed-section-leave-active {
  transition: opacity 200ms ease;
}

.new-feed-section-leave-to {
  opacity: 0;
}
</style>
