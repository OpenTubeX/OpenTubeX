<template>
  <div
    v-if="showsOnlyOtherItems"
    v-bind="$attrs"
    ref="otherFeed"
    class="newFeed"
  >
    <FtFlexBox v-if="clearingVisibleContent || shownOtherSections.length === 0">
      <p class="message">
        {{ t('Subscriptions.No New Content') }}
      </p>
    </FtFlexBox>
    <template v-if="!clearingVisibleContent">
      <section
        v-for="section in shownOtherSections"
        :key="section.id"
        :class="{ mediaSection: shownOtherSections.length > 1 }"
        :data-new-feed-section="section.id"
      >
        <!-- Headings only tell sources apart -->
        <h3 v-if="shownOtherSections.length > 1">
          {{ section.title }}
        </h3>
        <FtAutoGrid
          :grid="feedItemLayout === 'grid'"
          :item-count="section.items.length"
          :item-keys="section.keys"
        >
          <FtListFeedItem
            v-for="(item, index) in section.items"
            :key="section.keys[index]"
            :data-feed-item-key="section.keys[index]"
            :data="item"
            :layout="feedItemLayout"
            :avatar="section.avatar(item)"
            :seen-marks="section.seenMarks"
            in-new-feed
          />
        </FtAutoGrid>
      </section>
    </template>
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
    :error-feeds="errorFeeds"
    :attempted-fetch="attemptedFetch"
    :only-show-new="true"
    :has-additional-content="showCombinedView && (hasAdditionalContent || newRssItems.length > 0 || newPlatformItems.length > 0)"
    :has-other-refresh-sources="rssFeeds.length > 0 || platformChannels.length > 0"
    :is-community="activeCategory === 'posts'"
    :youtube-style-shorts="activeCategory === 'shorts' && useCustomShortsPlayer"
    :track-global-refresh="false"
    :show-loading-placeholder="false"
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
    <template
      v-for="section in otherSections"
      :key="section.id"
    >
      <Transition name="new-feed-section">
        <section
          v-if="showCombinedView && section.items.length > 0"
          class="mediaSection"
          :data-new-feed-section="section.id"
        >
          <h3>{{ section.title }}</h3>
          <FtAutoGrid
            :grid="feedItemLayout === 'grid'"
            :item-count="section.items.length"
            :item-keys="section.keys"
          >
            <FtListFeedItem
              v-for="(item, index) in section.items"
              :key="section.keys[index]"
              :data-feed-item-key="section.keys[index]"
              :data="item"
              :layout="feedItemLayout"
              :avatar="section.avatar(item)"
              :seen-marks="section.seenMarks"
              in-new-feed
            />
          </FtAutoGrid>
        </section>
      </Transition>
    </template>
  </SubscriptionsTabUi>
  <SubscriptionsTabUi
    v-else
    v-bind="$attrs"
    class="newFeed"
    :error-feeds="errorFeeds"
    :only-show-new="true"
    :track-global-refresh="false"
    :show-loading-placeholder="false"
    @refresh="refreshNewContent"
  />
  <FtPrompt
    v-if="showRefreshWarning"
    theme="readable-width"
    :label="$t('Subscriptions.New Feed Refresh Warning Title')"
    :extra-labels="[
      $t('Subscriptions.New Feed Refresh Warning', { count: activeSubscriptionIds.size }, activeSubscriptionIds.size),
      $t('Confirmations.Settings Hint')
    ]"
    :option-names="[$t('Yes'), $t('No'), $t('Confirmations.Never Ask Again')]"
    :option-values="['refresh', 'cancel', 'neverAskAgain']"
    :option-icons="[['fas', 'sync'], ['fas', 'xmark'], ['fas', 'eye-slash']]"
    autosize
    @click="handleRefreshWarning"
  />
</template>

<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, toRaw, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAutoGrid from './FtAutoGrid/FtAutoGrid.vue'
import FtElementList from './FtElementList/FtElementList.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtListFeedItem from './FtListFeedItem/FtListFeedItem.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import SubscriptionsTabUi from './SubscriptionsTabUi/SubscriptionsTabUi.vue'

import store from '../store/index'

import { useFeedRefreshShortcut } from '../composables/useFeedRefreshShortcut'
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
import {
  getFollowedChannels,
  platformFeed,
  platformFeedRefreshing,
  platformSeenMarks,
  refreshPlatformFeed,
  refreshPlatformFeedIfNeeded
} from '../helpers/platformFeed'
import { sortNewestFirst } from '../../twitchFollows'
import { getPlatformChannelKey, getPlatformItemKey } from '../../platforms/index'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  activeCategory: {
    type: String,
    default: null,
    validator: value => value === null || ['videos', 'shorts', 'live', 'posts', 'feeds', 'platforms'].includes(value)
  }
})

const { t } = useI18n()
const isElectron = process.env.IS_ELECTRON
const feed = useTemplateRef('feed')
const otherFeed = useTemplateRef('otherFeed')
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
    const element = showsOnlyOtherItems.value ? otherFeed.value : feed.value?.$el
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
  handleRefreshWarning,
  isRefreshing,
  refresh,
  showRefreshWarning
} = useRefreshAllSubscriptionFeeds()
const errorFeeds = computed(() => enabledFeeds.value.map(feed => feed.category))

const forbiddenTitles = computed(() => store.getters.getForbiddenTitlesToRemove)
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

// Watched-state changes must reach the refresh snapshot. The revision skips
// playback progress updates and avoids rescanning history on every publish.
watch(() => store.state.history.historyEntriesRevision, () => {
  if (cachedContentDuringRefresh.value !== null) {
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

const platformChannels = computed(() => getFollowedChannels())
const platformAvatars = computed(() => new Map(platformChannels.value.map(channel => [getPlatformChannelKey(channel), channel.avatar ?? null])))
// Clips come from viewers, so only live streams and uploads are new content
const newPlatformItems = computed(() => {
  const keys = new Set(platformChannels.value.map(getPlatformChannelKey))
  const { live, videos } = platformFeed.value
  const items = sortNewestFirst([...live, ...videos].filter(item => (
    item.isNew === true && keys.has(getPlatformChannelKey({ platform: item.platform, id: item.channelId })) &&
    // Every broadcast of a channel shares its address, so live streams are never watched
    (item.isLive === true || !getExternalMediaProgress(item.url)?.watched)
  )))
  return sortBy.value === 'oldest' ? items.toReversed() : items
})
// The New feed lists the new items of followed channels without opening their tab first
watch(platformChannels, refreshPlatformFeedIfNeeded, { immediate: true })
onActivated(refreshPlatformFeedIfNeeded)

// Full width is a single-column grid, so its items render as grid cards.
const feedItemLayout = computed(() => store.getters.getListType === 'list' ? 'list' : 'grid')
/** Items from other platforms, after the subscription feeds */
const otherSections = computed(() => [
  {
    id: 'platforms',
    title: t('Subscriptions.Platforms.Tab'),
    items: newPlatformItems.value,
    keys: newPlatformItems.value.map(getPlatformItemKey),
    avatar: item => platformAvatars.value.get(getPlatformChannelKey({ platform: item.platform, id: item.channelId })),
    seenMarks: platformSeenMarks
  },
  {
    id: 'feeds',
    title: t('Subscriptions.RSS Feeds.Tab'),
    items: newRssItems.value,
    keys: newRssItemKeys.value,
    avatar: item => rssFeedAvatars.value.get(item.feedUrl),
    seenMarks: null
  }
])
// The tab of another platform, or the combined feed while every subscription feed is hidden
const showsOnlyOtherItems = computed(() => {
  return props.activeCategory === 'feeds' || props.activeCategory === 'platforms' ||
    (showCombinedView.value && (enableRssFeeds.value || platformChannels.value.length > 0) && enabledFeeds.value.length === 0)
})
const shownOtherSections = computed(() => otherSections.value.filter(section => (
  section.items.length > 0 && (showCombinedView.value || section.id === props.activeCategory)
)))

const hasAdditionalContent = computed(() => {
  return newShorts.value.length > 0 || newLive.value.length > 0 || newPosts.value.length > 0
})

const isLoading = computed(() => {
  if (props.activeCategory === 'platforms') {
    return platformFeedRefreshing.value
  }

  if (showsOnlyOtherItems.value) {
    return rssFeedsRefreshing.value || (showCombinedView.value && platformFeedRefreshing.value)
  }

  if (!store.getters.getSubscriptionCacheReady) {
    return true
  }

  // A category tab only waits for its own feed, not for every feed that the
  // refresh still has to fetch before or after it
  if (!showCombinedView.value) {
    return store.getters.getSubscriptionFeedRefreshInProgress &&
      store.getters.getSubscriptionFeedRefreshTab === props.activeCategory
  }

  return isRefreshing.value || rssFeedsRefreshing.value || platformFeedRefreshing.value
})

const hasNewContent = computed(() => {
  if (showsOnlyOtherItems.value) {
    return shownOtherSections.value.length > 0
  }

  if (!showCombinedView.value) {
    return displayedEntries.value.length > 0
  }

  return newVideos.value.length > 0 || hasAdditionalContent.value || newRssItems.value.length > 0 ||
    newPlatformItems.value.length > 0
})

const hasNewContentByCategory = computed(() => ({
  videos: newVideos.value.length > 0,
  shorts: newShorts.value.length > 0,
  live: newLive.value.length > 0,
  posts: newPosts.value.length > 0,
  feeds: newRssItems.value.length > 0,
  platforms: newPlatformItems.value.length > 0
}))

function refreshNewContent() {
  if (props.activeCategory === 'platforms') {
    if (platformChannels.value.length > 0) refreshPlatformFeed()
  } else if (props.activeCategory === 'feeds') {
    if (rssFeeds.value.length > 0) refreshRssFeeds(rssFeeds.value)
  } else {
    // Refreshes the RSS feeds and the channels on other platforms too
    refresh()
  }
}

// The subscription feeds handle the shortcut themselves
useFeedRefreshShortcut(
  () => showsOnlyOtherItems.value && (rssFeeds.value.length > 0 || platformChannels.value.length > 0) && !isLoading.value,
  refreshNewContent
)

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
  letter-spacing: -0.01em;
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
