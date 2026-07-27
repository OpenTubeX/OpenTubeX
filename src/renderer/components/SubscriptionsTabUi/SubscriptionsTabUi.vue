<template>
  <div>
    <FtLoader
      v-if="displayIsLoading && activeVideoList.length === 0 && isCommunity"
    />
    <FtSkeletonGrid
      v-if="displayIsLoading && activeVideoList.length === 0 && !isCommunity"
    />
    <div
      v-if="!displayIsLoading && errorChannels.length !== 0"
    >
      <h3> {{ $t("Subscriptions.Error Channels") }}</h3>
      <FtFlexBox>
        <FtChannelBubble
          v-for="channel in errorChannels"
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
      :use-channels-hidden-preference="false"
      :display="isCommunity ? 'list' : ''"
      :stable-item-keys="stableItemKeys"
    />
    <slot />
    <FtAutoLoadNextPageWrapper
      v-if="activeVideoList.length > 0 && filteredVideoList.length > dataLimit"
      @load-next-page="increaseLimit"
    >
      <FtFlexBox>
        <FtButton
          :label="isCommunity ? $t('Subscriptions.Load More Posts') : $t('Subscriptions.Load More Videos')"
          background-color="var(--primary-color)"
          text-color="var(--text-with-main-color)"
          @click="increaseLimit"
        />
      </FtFlexBox>
    </FtAutoLoadNextPageWrapper>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import FtAutoLoadNextPageWrapper from '../FtAutoLoadNextPageWrapper.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtChannelBubble from '../FtChannelBubble/FtChannelBubble.vue'
import FtElementList from '../FtElementList/FtElementList.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtSkeletonGrid from '../FtSkeletonGrid/FtSkeletonGrid.vue'

import store from '../../store/index'

import { KeyboardShortcuts } from '../../../constants'
import { isHistoryEntryWatched } from '../../helpers/history'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import { useTabContext } from '../../tabs/TabContext'

const { tabId, isTabPresented } = useTabContext()
const subscriptionLimitStorageKey = tabId ? `Subscriptions/${tabId}/dataLimit` : 'subscriptionLimit'

const props = defineProps({
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
    default: false
  },
  hasAdditionalContent: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['refresh'])

const subscriptionLimit = sessionStorage.getItem(subscriptionLimitStorageKey)

const dataLimit = ref(subscriptionLimit !== null ? parseInt(subscriptionLimit) : props.initialDataLimit)

const activeVideoList = computed(() => {
  if (filteredVideoList.value.length < dataLimit.value) {
    return filteredVideoList.value
  } else {
    return filteredVideoList.value.slice(0, dataLimit.value)
  }
})

const activeProfileHasSubscriptions = computed(() => {
  return store.getters.getActiveProfile.subscriptions.length > 0
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

const onlyShowLatestFromChannel = computed(() => {
  return store.getters.getOnlyShowLatestFromChannel
})

const onlyShowLatestFromChannelNumber = computed(() => {
  return store.getters.getOnlyShowLatestFromChannelNumber
})

const hideLiveStreams = computed(() => store.getters.getHideLiveStreams)
const hideUpcomingPremieres = computed(() => store.getters.getHideUpcomingPremieres)
const forbiddenTitles = computed(() => store.getters.getForbiddenTitlesParsed)

const filteredVideoList = computed(() => {
  let videoList = props.videoList

  // Subscription feeds intentionally ignore the general hidden-channel list.
  videoList = videoList.filter(video => !isVideoHiddenByPreferences(video, {
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

  if (!props.isCommunity && onlyShowLatestFromChannel.value) {
    const authors = new Map()
    videoList = videoList.filter((video) => {
      if (!video.videoId || !video.authorId) {
        return true
      }

      if (!authors.has(video.authorId)) {
        authors.set(video.authorId, 1)
        return true
      } else {
        const currentVideos = authors.get(video.authorId)

        if (currentVideos < onlyShowLatestFromChannelNumber.value) {
          authors.set(video.authorId, currentVideos + 1)
          return true
        }
      }

      return false
    })
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

/**
 * @param {KeyboardEvent} event
 */
function keyboardShortcutHandler(event) {
  // Tabs stay mounted while not presented, so this document-level listener would
  // otherwise refresh the subscriptions of a background tab. Only handle the
  // shortcut when this tab is the one currently on screen.
  if (isTabPresented && !isTabPresented.value) {
    return
  }
  if (document.activeElement.classList.contains('ft-input')) {
    return
  }
  // Avoid handling events due to user holding a key (not released)
  // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat
  if (event.repeat) { return }

  if (
    (
      matchesKeyboardShortcut(event, KeyboardShortcuts.APP.SITUATIONAL.REFRESH) ||
      (
        store.getters.getSelectedTabIds.length <= 1 &&
        matchesKeyboardShortcut(event, KeyboardShortcuts.APP.GENERAL.RELOAD_TAB)
      )
    ) &&
    !displayIsLoading.value &&
    activeProfileHasSubscriptions.value
  ) {
    event.preventDefault()
    refresh()
  }
}

onMounted(() => {
  document.addEventListener('keydown', keyboardShortcutHandler)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', keyboardShortcutHandler)
})

function refresh() {
  emit('refresh')
}

defineExpose({ hasNewContent })
</script>

<style scoped src="./SubscriptionsTabUi.css" />
