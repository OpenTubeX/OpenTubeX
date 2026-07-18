<template>
  <div>
    <FtLoader
      v-if="displayIsLoading && activeVideoList.length === 0"
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
      v-if="!displayIsLoading && activeVideoList.length === 0"
    >
      <p
        v-if="!activeProfileHasSubscriptions"
        class="message"
      >
        {{ $t("Subscriptions['Your Subscription list is currently empty. Start adding subscriptions to see them here.']") }}
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
    <FtElementList
      v-if="activeVideoList.length > 0"
      :data="activeVideoList"
      :use-channels-hidden-preference="false"
      :display="isCommunity ? 'list' : ''"
      :show-new-subscription-feed-indicator="displayNewSubscriptionFeedIndicator"
    />
    <FtAutoLoadNextPageWrapper
      v-if="activeVideoList.length > 0 && videoList.length > dataLimit"
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

import store from '../../store/index'

import { KeyboardShortcuts } from '../../../constants'
import { isHistoryEntryWatched } from '../../helpers/history'
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

const displayIsLoading = computed(() => {
  return props.isLoading || subscriptionFeedRefreshInProgress.value
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

const showNewSubscriptionFeedIndicators = computed(() => {
  return store.getters.getShowNewSubscriptionFeedIndicators
})

const filteredVideoList = computed(() => {
  let videoList = props.videoList

  if (!props.isCommunity && hideWatchedSubs.value) {
    videoList = videoList.filter((video) => {
      return !isHistoryEntryWatched(historyCacheById.value[video.videoId])
    })
  }

  if (!props.isCommunity && onlyShowLatestFromChannel.value) {
    const authors = new Map()
    videoList = videoList.filter((video) => {
      if (!video.authorId) {
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

  if (!showNewSubscriptionFeedIndicators.value) {
    return videoList
  }

  return [
    ...videoList.filter(entry => entry.isNewInSubscriptionFeed === true),
    ...videoList.filter(entry => entry.isNewInSubscriptionFeed !== true)
  ]
})

const displayNewSubscriptionFeedIndicator = computed(() => {
  if (!showNewSubscriptionFeedIndicators.value || activeVideoList.value.length === 0) {
    return false
  }

  const includesPreviouslyFetchedEntry = activeVideoList.value.some(entry => {
    return entry.isNewInSubscriptionFeed !== true
  })

  return includesPreviouslyFetchedEntry || activeVideoList.value.length === filteredVideoList.value.length
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

  switch (event.key.toLowerCase()) {
    case 'f5':
    case KeyboardShortcuts.APP.SITUATIONAL.REFRESH:
      if (!displayIsLoading.value && activeProfileHasSubscriptions.value) {
        event.preventDefault()
        refresh()
      }
      break
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
</script>

<style scoped src="./SubscriptionsTabUi.css" />
