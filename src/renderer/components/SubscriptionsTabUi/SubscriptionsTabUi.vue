<template>
  <div>
    <FtLoader
      v-if="displayIsLoading && activeVideoList.length === 0 && isCommunity"
    />
    <FtSkeletonGrid
      v-if="displayIsLoading && activeVideoList.length === 0 && !isCommunity"
      :youtube-style-shorts="youtubeStyleShorts"
    />
    <div
      v-if="!displayIsLoading && visibleErrorChannels.length !== 0"
    >
      <h3> {{ $t("Subscriptions.Error Channels") }}</h3>
      <FtFlexBox>
        <FtChannelBubble
          v-for="channel in visibleErrorChannels"
          :key="channel.id"
          :channel-name="channel.name"
          :channel-id="channel.id"
          :channel-thumbnail="channel.thumbnail"
        />
      </FtFlexBox>
    </div>
    <FtFlexBox
      v-if="!displayIsLoading && activeVideoList.length === 0 && !hasAdditionalContent"
    >
      <p
        v-if="!activeProfileHasSubscriptions"
        class="message"
      >
        {{ $t("Subscriptions['Your Subscription list is currently empty. Start adding subscriptions to see them here.']") }}
      </p>
      <p
        v-else-if="activeGroupIsEmpty"
        class="message"
      >
        {{ $t('Subscription Groups.Empty Group') }}
      </p>
      <p
        v-else-if="onlyShowNew"
        class="message"
      >
        {{ $t("Subscriptions.No New Content") }}
      </p>
      <p
        v-else-if="!fetchSubscriptionsAutomatically && !attemptedFetch"
        class="message"
      >
        {{ $t("Subscriptions.Disabled Automatic Fetching") }}
      </p>
      <p
        v-else
        class="message"
      >
        {{ isCommunity ? $t("Subscriptions.Empty Posts") : $t("Subscriptions.Empty Channels") }}
      </p>
    </FtFlexBox>
    <slot
      name="before-list"
      :has-visible-content="activeVideoList.length > 0"
    />
    <FtElementList
      :data="activeVideoList"
      :data-overrides="dataOverrides"
      :subscription-feed-type="subscriptionFeedType ?? refreshTab"
      :use-channels-hidden-preference="false"
      :display="isCommunity ? 'list' : ''"
      :stable-item-keys="stableItemKeys"
      :render-all-items-lazily="isElectron"
      :youtube-style-shorts="youtubeStyleShorts"
    />
    <slot />
    <FtAutoLoadNextPageWrapper
      v-if="activeVideoList.length > 0 && filteredVideoList.length > dataLimit"
      @load-next-page="increaseLimit"
    >
      <FtFlexBox>
        <FtButton
          :label="isCommunity ? $t('Subscriptions.Load More Posts') : $t('Subscriptions.Load More Videos')"
          :icon="['fas', 'arrow-down']"
          background-color="var(--primary-color)"
          text-color="var(--text-with-main-color)"
          @click="increaseLimit"
        />
      </FtFlexBox>
    </FtAutoLoadNextPageWrapper>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'

import FtAutoLoadNextPageWrapper from '../FtAutoLoadNextPageWrapper.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtChannelBubble from '../FtChannelBubble/FtChannelBubble.vue'
import FtElementList from '../FtElementList/FtElementList.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtSkeletonGrid from '../FtSkeletonGrid/FtSkeletonGrid.vue'

import store from '../../store/index'

import { useFeedRefreshShortcut } from '../../composables/useFeedRefreshShortcut'
import { useKeepAliveEffectScope } from '../../composables/useKeepAliveEffectScope'
import { useSubscriptionEntryVersion } from '../../composables/useSubscriptionEntryVersion'
import { isHistoryEntryWatched } from '../../helpers/history'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import {
  applySubscriptionVideoLimit,
  filterMembersOnlySubscriptionVideos
} from '../../helpers/subscription-channels'
import { useTabContext } from '../../tabs/TabContext'

const { tabId } = useTabContext()
const isElectron = process.env.IS_ELECTRON
useKeepAliveEffectScope()

const props = defineProps({
  dataOverrides: {
    type: Object,
    default: null
  },
  subscriptionFeedType: {
    type: String,
    default: null
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  videoList: {
    type: Array,
    default: () => []
  },
  isCommunity: {
    type: Boolean,
    default: false
  },
  errorChannels: {
    type: Array,
    default: () => []
  },
  attemptedFetch: {
    type: Boolean,
    default: false
  },
  initialDataLimit: {
    type: Number,
    default: 100
  },
  onlyShowNew: {
    type: Boolean,
    default: false
  },
  trackGlobalRefresh: {
    type: Boolean,
    default: true
  },
  refreshTab: {
    type: String,
    default: null
  },
  stableItemKeys: {
    type: Boolean,
    default: true
  },
  hasAdditionalContent: {
    type: Boolean,
    default: false
  },
  /** The refresh also covers sources besides the subscriptions, such as RSS feeds */
  hasOtherRefreshSources: {
    type: Boolean,
    default: false
  },
  youtubeStyleShorts: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['refresh'])

const paginationKey = props.refreshTab ?? (props.onlyShowNew ? 'new' : 'subscriptions')
const subscriptionLimitStorageKey = tabId
  ? `Subscriptions/${tabId}/${paginationKey}/dataLimit`
  : `subscriptionLimit/${paginationKey}`
const subscriptionLimit = sessionStorage.getItem(subscriptionLimitStorageKey)

const dataLimit = ref(subscriptionLimit !== null ? parseInt(subscriptionLimit) : props.initialDataLimit)
const subscriptionEntryVersion = useSubscriptionEntryVersion()

const activeVideoList = computed(() => {
  let activeEntries
  if (filteredVideoList.value.length < dataLimit.value) {
    activeEntries = filteredVideoList.value
  } else {
    activeEntries = filteredVideoList.value.slice(0, dataLimit.value)
  }

  // Only the rendered page needs field-level reactivity. Tracking every field
  // in a large cached feed makes mounting the tab scale with the full cache.
  return activeEntries.map(entry => reactive(entry))
})

const activeProfileHasSubscriptions = computed(() => {
  return store.getters.getActiveProfile.subscriptions.length > 0
})

// Refreshes cover the whole profile, so only list the errors of the shown channels
const visibleErrorChannels = computed(() => {
  if (store.getters.getActiveSubscriptionGroup === null) return props.errorChannels
  const channelIds = new Set(store.getters.getActiveGroupSubscriptions.map(channel => channel.id))
  return props.errorChannels.filter(channel => channelIds.has(channel.id))
})

const activeGroupIsEmpty = computed(() => {
  return store.getters.getActiveSubscriptionGroup !== null && store.getters.getActiveGroupSubscriptions.length === 0
})

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionFeedRefreshInProgress = computed(() => {
  return store.getters.getSubscriptionFeedRefreshInProgress
})

const subscriptionFeedRefreshTab = computed(() => {
  return store.getters.getSubscriptionFeedRefreshTab
})

const displayIsLoading = computed(() => {
  const isRelevantGlobalRefresh = props.trackGlobalRefresh &&
    subscriptionFeedRefreshInProgress.value &&
    (props.refreshTab === null || subscriptionFeedRefreshTab.value === props.refreshTab)

  return props.isLoading || isRelevantGlobalRefresh
})

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => {
  return store.getters.getFetchSubscriptionsAutomatically
})

const historyCacheById = computed(() => {
  return store.getters.getHistoryCacheById
})

const hideWatchedSubs = computed(() => {
  return store.getters.getHideWatchedSubs
})

const globalVideoLimit = computed(() => (
  store.getters.getOnlyShowLatestFromChannel
    ? store.getters.getOnlyShowLatestFromChannelNumber
    : null
))

const hideLiveStreams = computed(() => store.getters.getHideLiveStreams)
const hideUpcomingPremieres = computed(() => store.getters.getHideUpcomingPremieres)
const forbiddenTitles = computed(() => store.getters.getActiveForbiddenTitles)
const restrictedPlaybackConfigured = computed(() => (
  hasConfiguredRestrictedPlaybackAuthentication(store.getters)
))

const filteredVideoList = computed(() => {
  // Copy after in-place cache mutations so the rendered page receives fresh
  // props even though the full cached array stays non-reactive.
  let videoList = subscriptionEntryVersion.value === 0
    ? props.videoList
    : props.videoList.slice()

  if (!props.isCommunity) {
    videoList = filterMembersOnlySubscriptionVideos(
      videoList,
      store.getters.getActiveProfile.subscriptions,
      restrictedPlaybackConfigured.value
    )
  }

  // Subscription feeds intentionally ignore the general hidden-channel list.
  // Active metadata filters must track in-place cache edits before pagination.
  // Keep the unfiltered scan raw so large feeds avoid unnecessary tracking.
  const trackMetadata = hideLiveStreams.value || hideUpcomingPremieres.value || forbiddenTitles.value.length > 0
  videoList = videoList.filter(video => !isVideoHiddenByPreferences(trackMetadata ? reactive(video) : video, {
    hideLiveStreams: hideLiveStreams.value,
    hideUpcomingPremieres: hideUpcomingPremieres.value,
    forbiddenTitles: forbiddenTitles.value
  }))

  if (props.onlyShowNew) {
    videoList = videoList.filter(entry => {
      return entry.isNewInSubscriptionFeed === true &&
        (entry.videoId == null || !isHistoryEntryWatched(historyCacheById.value[entry.videoId]))
    })
  }

  if (!props.isCommunity && hideWatchedSubs.value) {
    videoList = videoList.filter((video) => {
      return video.videoId == null || !isHistoryEntryWatched(historyCacheById.value[video.videoId])
    })
  }

  if (!props.isCommunity) {
    videoList = applySubscriptionVideoLimit(
      videoList,
      store.getters.getActiveProfile.subscriptions,
      globalVideoLimit.value
    )
  }

  return videoList
})

const hasNewContent = computed(() => {
  return filteredVideoList.value.some(entry => {
    return entry.isNewInSubscriptionFeed === true &&
      (entry.videoId == null || !isHistoryEntryWatched(historyCacheById.value[entry.videoId]))
  })
})

function increaseLimit() {
  dataLimit.value += props.initialDataLimit
  sessionStorage.setItem(subscriptionLimitStorageKey, dataLimit.value.toFixed(0))
}

useFeedRefreshShortcut(
  () => !displayIsLoading.value && (activeProfileHasSubscriptions.value || props.hasOtherRefreshSources),
  refresh
)

function refresh() {
  emit('refresh')
}

defineExpose({ hasNewContent })
</script>

<style scoped src="./SubscriptionsTabUi.css" />
