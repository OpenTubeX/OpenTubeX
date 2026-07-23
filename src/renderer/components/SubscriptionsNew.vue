<template>
  <SubscriptionsTabUi
    ref="tabUi"
    class="newFeed"
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
    <template #before-list="{ hasVisibleContent }">
      <h3 v-if="hasVisibleContent">
        {{ $t('Global.Videos') }}
      </h3>
    </template>
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
const forbiddenTitles = computed(() => store.getters.getForbiddenTitlesParsed)
const newPosts = computed(() => newContent.value.filter(entry => {
  const lowerCaseAuthor = entry.author?.toLowerCase()

  return entry.postId != null &&
    !forbiddenTitles.value.some(text => lowerCaseAuthor?.includes(text))
}))

const isLoading = computed(() => {
  return !store.getters.getSubscriptionCacheReady || isRefreshing.value
})

const hasNewContent = computed(() => {
  return newPosts.value.length > 0 || tabUi.value?.hasNewContent === true
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
.postsSection {
  margin-block-start: 32px;
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
