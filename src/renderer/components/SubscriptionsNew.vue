<template>
  <div
    v-if="activeCategory === 'feeds'"
    v-bind="$attrs"
    ref="rssFeed"
    class="newFeed"
  >
    <FtSkeletonGrid v-if="rssFeedsRefreshing && newRssItems.length === 0" />
    <FtFlexBox v-else-if="clearingVisibleContent || newRssItems.length === 0">
      <p class="message">
        {{ t('Subscriptions.No New Content') }}
      </p>
    </FtFlexBox>
    <FtAutoGrid
      v-if="!clearingVisibleContent"
      :grid="rssLayout === 'grid'"
      :item-count="newRssItems.length"
      :item-keys="newRssItemKeys"
    >
      <FtListFeedItem
        v-for="(item, index) in newRssItems"
        :key="newRssItemKeys[index]"
        :data-feed-item-key="newRssItemKeys[index]"
        :data="item"
        :layout="rssLayout"
        :avatar="rssFeedAvatars.get(item.feedUrl)"
        in-new-feed
      />
    </FtAutoGrid>
  </div>
  <SubscriptionsTabUi
    v-else-if="!clearingVisibleContent"
    ref="feed"
    v-bind="$attrs"
    class="newFeed"
    :is-loading="isLoading"
    :video-list="displayedEntries"
    :data-overrides="newFeedDataOverrides"
    :subscription-feed-type="activeCategory ?? 'videos'"
    :error-channels="errorChannels"
    :attempted-fetch="attemptedFetch"
    :only-show-new="true"
    :has-additional-content="showCombinedView && (hasAdditionalContent || newRssItems.length > 0)"
    :is-community="activeCategory === 'posts'"
    :youtube-style-shorts="activeCategory === 'shorts' && useCustomShortsPlayer"
    :track-global-refresh="false"
    stable-item-keys
    @refresh="refreshNewContent"
  >
    <template #before-list="{ hasVisibleContent }">
      <h3 v-if="showCombinedView && hasVisibleContent">
        {{ $t('Global.Videos') }}
      </h3>
    </template>
    <Transition name="new-feed-section">
      <section
        v-if="showCombinedView && newShorts.length > 0"
        class="mediaSection"
      >
        <h3>{{ $t('Global.Shorts') }}</h3>
        <FtElementList
          :data="newShorts"
          :data-overrides="newFeedDataOverrides"
          subscription-feed-type="shorts"
          :render-all-items-lazily="isElectron"
          stable-item-keys
          :youtube-style-shorts="useCustomShortsPlayer"
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <Transition name="new-feed-section">
      <section
        v-if="showCombinedView && newLive.length > 0"
        class="mediaSection"
      >
        <h3>{{ $t('Global.Live') }}</h3>
        <FtElementList
          :data="newLive"
          :data-overrides="newFeedDataOverrides"
          subscription-feed-type="live"
          :render-all-items-lazily="isElectron"
          stable-item-keys
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <Transition name="new-feed-section">
      <section
        v-if="showCombinedView && newPosts.length > 0"
        class="postsSection"
      >
        <h3>{{ $t('Global.Posts') }}</h3>
        <FtElementList
          :data="newPosts"
          :data-overrides="newFeedDataOverrides"
          subscription-feed-type="posts"
          :render-all-items-lazily="isElectron"
          display="list"
          stable-item-keys
          :use-channels-hidden-preference="false"
        />
      </section>
    </Transition>
    <Transition name="new-feed-section">
      <section
        v-if="showCombinedView && newRssItems.length > 0"
        class="mediaSection"
      >
        <h3>{{ $t('Subscriptions.RSS Feeds.Tab') }}</h3>
        <FtAutoGrid
          :grid="rssLayout === 'grid'"
          :item-count="newRssItems.length"
          :item-keys="newRssItemKeys"
        >
          <FtListFeedItem
            v-for="(item, index) in newRssItems"
            :key="newRssItemKeys[index]"
            :data-feed-item-key="newRssItemKeys[index]"
            :data="item"
            :layout="rssLayout"
            :avatar="rssFeedAvatars.get(item.feedUrl)"
            in-new-feed
          />
        </FtAutoGrid>
      </section>
    </Transition>
  </SubscriptionsTabUi>
  <SubscriptionsTabUi
    v-else
    v-bind="$attrs"
    class="newFeed"
    :error-channels="errorChannels"
    :only-show-new="true"
    :track-global-refresh="false"
    @refresh="refreshNewContent"
  />
  <FtPrompt
    v-if="showRefreshWarning"
    :label="$t('Subscriptions.New Feed Refresh Warning Title')"
    :extra-labels="[$t('Subscriptions.New Feed Refresh Warning', { count: activeSubscriptionIds.size }, activeSubscriptionIds.size)]"
    :option-names="[$t('Yes'), $t('No')]"
    :option-values="['refresh', 'cancel']"
    autosize
    @click="handleRefreshWarning"
  />
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, shallowRef, toRaw, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAutoGrid from './FtAutoGrid/FtAutoGrid.vue'
import FtElementList from './FtElementList/FtElementList.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtListFeedItem from './FtListFeedItem/FtListFeedItem.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import FtSkeletonGrid from './FtSkeletonGrid/FtSkeletonGrid.vue'
import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useFollowedRssFeedItems } from '../composables/useFollowedRssFeedItems'
import { useKeepAliveEffectScope } from '../composables/useKeepAliveEffectScope'
import { useSubscriptionChannelUpdates } from '../composables/useSubscriptionChannelUpdates'
import { useRefreshAllSubscriptionFeeds } from '../composables/useRefreshAllSubscriptionFeeds'
import { getNewSubscriptionFeedEntries } from '../helpers/newSubscriptionFeed'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../helpers/restricted-playback'
import { MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES } from '../helpers/subscription-channels'
import { applyAnimationSpeed } from '../helpers/animationSpeed'
import { isReducedMotionEnabled } from '../helpers/reducedMotion'
import { getExternalMediaProgress } from '../helpers/externalMediaPosition'
import { getRssFeedItemKey, refreshRssFeeds, rssFeedsRefreshing } from '../helpers/rssFeeds'
import { supportsYtDlp } from '../helpers/ytDlpCapabilities'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  activeCategory: {
    type: String,
    default: null,
    validator: value => value === null || ['videos', 'shorts', 'live', 'posts', 'feeds'].includes(value)
  }
})

const { t } = useI18n()
const isElectron = process.env.IS_ELECTRON
const feed = useTemplateRef('feed')
const rssFeed = useTemplateRef('rssFeed')
const clearingVisibleContent = ref(false)
let removalAnimation = null

function cancelRemovalAnimation() {
  removalAnimation?.cancel()
  removalAnimation = null
  clearingVisibleContent.value = false
}

watch(() => props.activeCategory, cancelRemovalAnimation)
onDeactivated(cancelRemovalAnimation)
onBeforeUnmount(cancelRemovalAnimation)

/** @param {() => Promise<unknown>} markSeen */
async function markAllAsSeen(markSeen) {
  try {
    const element = props.activeCategory === 'feeds' ? rssFeed.value : feed.value?.$el
    if (element && !isReducedMotionEnabled()) {
      const animation = applyAnimationSpeed(element.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-10px)' }
      ], { duration: 200, easing: 'ease-in', fill: 'forwards' }))
      removalAnimation = animation
      await animation.finished.catch(() => {})
      // Switching categories or leaving the page cancels the presentation,
      // but the requested seen marks still need to be saved.
      if (removalAnimation === animation) {
        clearingVisibleContent.value = true
      }
    } else {
      clearingVisibleContent.value = true
    }
    // Dispose the whole feed before updating its entries. Hundreds of
    // individual Vue leave hooks otherwise each force their own reflow.
    await nextTick()
    await markSeen()
  } finally {
    cancelRemovalAnimation()
  }
}

const newFeedDataOverrides = {
  hideNewSubscriptionFeedIndicator: true,
  isInNewSubscriptionFeed: true,
}
useKeepAliveEffectScope()
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

const forbiddenTitles = computed(() => store.getters.getActiveForbiddenTitles)
const sortBy = computed(() => {
  return store.getters.getNewSubscriptionFeedSortBy === 'oldest' ? 'oldest' : 'newest'
})
const activeSubscriptions = computed(() => store.getters.getActiveGroupSubscriptions)
const cachedContentDuringRefresh = shallowRef(null)
let isLargeCachedFeed = false
const contentOptions = computed(() => ({
  activeSubscriptions: activeSubscriptions.value,
  historyCacheById: store.getters.getHistoryCacheById,
  hideLiveStreams: store.getters.getHideLiveStreams,
  hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
  forbiddenTitles: forbiddenTitles.value,
  onlyShowLatestFromChannel: store.getters.getOnlyShowLatestFromChannel,
  onlyShowLatestFromChannelNumber: store.getters.getOnlyShowLatestFromChannelNumber,
  restrictedPlaybackConfigured: hasConfiguredRestrictedPlaybackAuthentication(store.getters),
  showScheduledLiveStreamsFirst: store.getters.getShowScheduledLiveStreamsFirst,
  sortBy: sortBy.value
}))
const getCurrentContentByCategory = () => getNewSubscriptionFeedEntries({
  feeds: enabledFeeds.value,
  ...contentOptions.value
})
const newContentByCategory = computed(() => cachedContentDuringRefresh.value ?? getCurrentContentByCategory())
const watchedHistoryState = computed(() => {
  if (cachedContentDuringRefresh.value === null) return null
  return store.getters.getHistoryCacheSorted
    .map(({ videoId, isWatched }) => `${videoId}:${isWatched === true}`).join(',')
})

watch([
  () => store.getters.getSubscriptionFeedRefreshInProgress,
  () => store.getters.getSubscriptionFeedRefreshTab
], ([refreshing]) => {
  if (!refreshing) {
    cachedContentDuringRefresh.value = null
    isLargeCachedFeed = false
    return
  }

  let cachedEntryCount = 0
  for (const { cache, entriesKey } of enabledFeeds.value) {
    for (const channel of Object.values(cache)) {
      cachedEntryCount += channel?.[entriesKey]?.length ?? 0
      if (cachedEntryCount > MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES) break
    }
    if (cachedEntryCount > MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES) break
  }
  isLargeCachedFeed = cachedEntryCount > MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES
  // Snapshot every refresh so incoming responses cannot each rebuild the DOM.
  // Small feeds publish coalesced updates; large feeds publish in batches.
  cachedContentDuringRefresh.value = getCurrentContentByCategory()
}, { immediate: true, flush: 'sync' })

for (const feedType of ['videos', 'shorts', 'live', 'posts']) {
  useSubscriptionChannelUpdates(feedType, () => {
    if (cachedContentDuringRefresh.value === null) return
    cachedContentDuringRefresh.value = getCurrentContentByCategory()
  }, () => isLargeCachedFeed)
}

// Cache updates are batched during large refreshes, but local filtering and
// sort choices should affect the list immediately.
watch([
  contentOptions,
  () => store.getters.getSubscriptionSeenVideos,
  () => store.getters.getSubscriptionSeenPosts,
  () => [
    store.getters.getHideSubscriptionsVideos,
    store.getters.getHideSubscriptionsShorts,
    store.getters.getHideSubscriptionsLive,
    store.getters.getHideSubscriptionsCommunity,
    store.getters.getUseRssFeeds
  ].join(',')
], () => {
  if (cachedContentDuringRefresh.value !== null) {
    cachedContentDuringRefresh.value = getCurrentContentByCategory()
  }
})

watch(watchedHistoryState, (current, previous) => {
  if (current !== null && previous !== null) {
    cachedContentDuringRefresh.value = getCurrentContentByCategory()
  }
})

// The feed builder tracks fields used for selection and ordering. Downstream
// pagination should scan raw entries and make only rendered cards reactive.
const newVideos = computed(() => newContentByCategory.value.videos.map(toRaw))
const newShorts = computed(() => newContentByCategory.value.shorts.map(toRaw))
const newLive = computed(() => newContentByCategory.value.live.map(toRaw))
const newPosts = computed(() => newContentByCategory.value.posts.map(toRaw))
const useCustomShortsPlayer = computed(() => store.getters.getUseCustomShortsPlayer)
const showCombinedView = computed(() => props.activeCategory === null)
const displayedEntries = computed(() => {
  switch (props.activeCategory) {
    case 'shorts':
      return newShorts.value
    case 'live':
      return newLive.value
    case 'posts':
      return newPosts.value
    default:
      return newVideos.value
  }
})

// Items from other platforms open through yt-dlp
const enableRssFeeds = computed(() => supportsYtDlp && store.getters.getEnableRssFeeds)
const { feeds: rssFeeds, feedAvatars: rssFeedAvatars, items: rssItems } = useFollowedRssFeedItems(() => enableRssFeeds.value)
const newRssItems = computed(() => {
  const items = rssItems.value.filter(item => item.isNew === true && !getExternalMediaProgress(item.url)?.watched)
  return sortBy.value === 'oldest' ? items.toReversed() : items
})
const newRssItemKeys = computed(() => newRssItems.value.map(getRssFeedItemKey))
// Full width is a single-column grid, so its items render as grid cards.
const rssLayout = computed(() => store.getters.getListType === 'list' ? 'list' : 'grid')

const hasAdditionalContent = computed(() => {
  return newShorts.value.length > 0 || newLive.value.length > 0 || newPosts.value.length > 0
})

const isLoading = computed(() => {
  if (props.activeCategory === 'feeds') {
    return rssFeedsRefreshing.value
  }

  return !store.getters.getSubscriptionCacheReady || isRefreshing.value
})

const hasNewContent = computed(() => {
  if (props.activeCategory === 'feeds') {
    return newRssItems.value.length > 0
  }

  if (!showCombinedView.value) {
    return displayedEntries.value.length > 0
  }

  return newVideos.value.length > 0 || hasAdditionalContent.value || newRssItems.value.length > 0
})

const hasNewContentByCategory = computed(() => ({
  videos: newVideos.value.length > 0,
  shorts: newShorts.value.length > 0,
  live: newLive.value.length > 0,
  posts: newPosts.value.length > 0,
  feeds: newRssItems.value.length > 0
}))

function refreshNewContent() {
  if (props.activeCategory !== 'feeds') {
    refresh()
  }
  if ((props.activeCategory === 'feeds' || showCombinedView.value) && rssFeeds.value.length > 0) {
    refreshRssFeeds(rssFeeds.value)
  }
}

defineExpose({
  markAllAsSeen,
  refresh: refreshNewContent,
  isLoading,
  lastRefreshTimestamp: '',
  nextAutoRefreshTimestamp: '',
  nextAutoRefreshTooltip: '',
  refreshTitle: computed(() => t('Subscriptions.New Content')),
  hasNewContent,
  hasNewContentByCategory
})
</script>

<style scoped>
.message {
  margin-block: 16px 0;
  color: var(--tertiary-text-color);
}

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
