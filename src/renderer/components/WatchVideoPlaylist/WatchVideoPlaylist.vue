<template>
  <FtCard
    class="relative"
    :class="{ fullscreenPlaylist: fullscreenOverlay, phonePlaylist: phonePanel, isCollapsed: playlistCollapsed }"
  >
    <FtLoader
      v-if="isLoading"
    />
    <template v-else>
      <header
        v-if="fullscreenOverlay"
        class="playlistDockHeader"
      >
        <FtIcon :icon="['fas', 'list']" />
        <h3
          dir="auto"
          :title="playlistTitle"
        >
          {{ playlistTitle }}
        </h3>
        <button
          type="button"
          class="playlistDockClose"
          :aria-label="t('Playlist.Close Playlist')"
          :title="t('Playlist.Close Playlist')"
          @click="emit('close')"
        >
          <FtIcon :icon="['fas', 'xmark']" />
        </button>
      </header>
      <div
        v-overlay-scrollbars="fullscreenOverlay"
        :class="{ fullscreenPlaylistContent: fullscreenOverlay }"
      >
        <div class="playlistHeader">
          <Teleport
            :to="phonePanelHeader || 'body'"
            :disabled="!phonePanelHeader"
          >
            <div
              v-if="!fullscreenOverlay"
              class="playlistTitleRow"
            >
              <h3
                class="playlistTitle"
                :title="playlistTitle"
              >
                <RouterLink
                  class="playlistTitleLink"
                  dir="auto"
                  :to="playlistPageLinkTo"
                >
                  {{ playlistTitle }}
                </RouterLink>
              </h3>
              <button
                v-if="!phonePanel"
                class="playlistButton playlistCollapseButton"
                :aria-label="playlistCollapsed ? t('Video.Expand Playlist') : t('Video.Collapse Playlist')"
                :aria-expanded="!playlistCollapsed"
                :title="playlistCollapsed ? t('Video.Expand Playlist') : t('Video.Collapse Playlist')"
                @click="toggleCollapse"
              >
                <FtIcon
                  class="playlistIcon"
                  :icon="['fas', playlistCollapsed ? 'angle-down' : 'angle-up']"
                />
              </button>
            </div>
          </Teleport>
          <template
            v-if="!playlistCollapsed && channelName !== ''"
          >
            <RouterLink
              v-if="channelId"
              class="channelName"
              dir="auto"
              :to="`/channel/${channelId}`"
            >
              {{ channelName }}<span
                class="channelNameSeparator"
                aria-hidden="true"
              > -</span>
            </RouterLink>
            <bdi
              v-else
              class="channelName"
            >
              {{ channelName }}<span
                class="channelNameSeparator"
                aria-hidden="true"
              > -</span>
            </bdi>
          </template>
          <span
            class="playlistIndex"
            :class="{ isCollapsed: playlistCollapsed }"
          >
            <label for="playlistProgressBar">
              {{ currentVideoIndexOneBased }} / {{ playlistVideoCount }}
            </label>

            <!-- eslint-disable vuejs-accessibility/mouse-events-have-key-events, vuejs-accessibility/click-events-have-key-events -->
            <div
              v-if="!playlistCollapsed && !shuffleEnabled && !reversePlaylist"
              class="playlistProgressBarContainer"
              @mouseenter="showProgressBarPreview = true"
              @mouseleave="showProgressBarPreview = false"
              @mousemove="updateProgressBarPreview"
            >
              <div
                ref="playlistProgressBar"
                class="playlistProgressBar"
                :class="{ expanded: showProgressBarPreview }"
                @click="handleProgressBarClick"
              >
                <div
                  class="playlistProgressBarFill"
                  :style="{ width: (currentVideoIndexOneBased / playlistVideoCount) * 100 + '%' }"
                />
                <div
                  v-if="showProgressBarPreview"
                  ref="progressBarPreview"
                  class="progressBarPreview"
                  :style="previewStyle"
                >
                  <div class="previewTooltip">
                    <FtRetryImage
                      v-if="previewVideoThumbnail"
                      :src="previewVideoThumbnail"
                      alt=""
                      class="previewThumbnail"
                    />
                    <div class="previewText">
                      {{ previewVideoIndex }} / {{ playlistVideoCount }}
                    </div>
                    <div
                      class="previewVideoTitle"
                      dir="auto"
                    >{{ previewVideoTitle }}</div>
                  </div>
                </div>
              </div>
            </div>
          </span>
          <Teleport
            :to="phonePanelHeader || 'body'"
            :disabled="!phonePanelHeader"
          >
            <div
              v-show="!playlistCollapsed"
              class="playlistButtons"
              :class="{ phonePlaylistActions: phonePanelHeader }"
            >
              <button
                class="playlistButton"
                :class="{ playlistButtonActive: loopEnabled }"
                :aria-label="t('Video.Loop Playlist')"
                :aria-pressed="loopEnabled"
                :title="t('Video.Loop Playlist')"
                @click="toggleLoop"
              >
                <FtIcon
                  class="playlistIcon"
                  :icon="['fas', 'retweet']"
                />
              </button>
              <button
                class="playlistButton"
                :class="{ playlistButtonActive: shuffleEnabled }"
                :aria-label="t('Video.Shuffle Playlist')"
                :aria-pressed="shuffleEnabled"
                :title="t('Video.Shuffle Playlist')"
                @click="toggleShuffle"
              >
                <FtIcon
                  class="playlistIcon"
                  :icon="['fas', 'random']"
                />
              </button>
              <button
                class="playlistButton"
                :class="{ playlistButtonActive: reversePlaylist }"
                :aria-label="t('Video.Reverse Playlist')"
                :aria-pressed="reversePlaylist"
                :title="t('Video.Reverse Playlist')"
                @click="toggleReversePlaylist"
              >
                <FtIcon
                  class="playlistIcon"
                  :icon="['fas', 'exchange-alt']"
                />
              </button>
              <button
                v-if="userPlaylistWatchedVideoCount > 0"
                class="playlistButton"
                :aria-label="t('User Playlists.Remove Watched Videos')"
                :title="t('User Playlists.Remove Watched Videos')"
                @click="showRemoveWatchedVideosPrompt = true"
              >
                <FtIcon
                  class="playlistIcon"
                  :icon="['fas', 'eye-slash']"
                />
              </button>
            </div>
          </Teleport>
        </div>
        <component
          :is="playlistItemsWrapperComponent"
          v-if="!isLoading"
          v-show="!playlistCollapsed"
          ref="playlistItemsWrapper"
          v-overlay-scrollbars
          :name="animatePlaylistItems ? 'playlistItem' : undefined"
          :tag="animatePlaylistItems ? 'div' : undefined"
          class="playlistItemsWrapper"
        >
          <FtListVideoNumbered
            v-for="(item, index) in playlistItems"
            :key="item._libraryMemberId || item.playlistItemId || item.videoId"
            ref="playlistItem"
            class="playlistItem"
            :data="item"
            :playlist-id="playlistId"
            :playlist-type="playlistType"
            :playlist-index="isPagedPlaylist ? (reversePlaylist ? userWindow.total - userWindow.offset - index - 1 : userWindow.offset + index) : (reversePlaylist ? playlistItems.length - index - 1 : index)"
            :playlist-item-id="item.playlistItemId"
            :download-id="downloadId"
            :playlist-reverse="reversePlaylist"
            :playlist-shuffle="shuffleEnabled"
            :playlist-loop="loopEnabled"
            :video-index="isPagedPlaylist ? userWindow.offset + index : index"
            :is-current-video="currentVideoIndexZeroBased === index"
            :can-move-video-up="(isPagedPlaylist ? userWindow.offset + index : index) > 0 && canMoveVideos"
            :can-move-video-down="(isPagedPlaylist ? userWindow.offset + index < userWindow.total - 1 : index < playlistItems.length - 1) && canMoveVideos"
            :can-remove-from-playlist="isUserPlaylist"
            :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
            :dragged-video="draggedVideo"
            :is-sort-order-custom="isSortOrderCustom"
            :is-video-dragging="isVideoDragging"
            appearance="watchPlaylistItem"
            :initial-visible-state="index < (currentVideoIndexZeroBased + 4) && index > (currentVideoIndexZeroBased - 4)"
            @drag-video="setDraggedVideo"
            @drag-video-end="onDragVideoEnd"
            @move-dragged-video="onMoveDraggedVideo"
            @move-video-up="moveVideoUp"
            @move-video-down="moveVideoDown"
            @remove-from-playlist="removeVideoFromPlaylist"
            @pause-player="pausePlayer"
          />
          <FtButton
            v-if="isPagedPlaylist && userWindow.offset > 0"
            class="playlistPagination"
            :label="t('Playing Previous Video')"
            :icon="['fas', 'step-backward']"
            @click="loadUserPlaylistWindow(Math.max(0, userWindow.offset - 100))"
          />
          <FtButton
            v-if="isPagedPlaylist && userWindow.offset + playlistItems.length < userWindow.total"
            class="playlistPagination"
            :label="t('Subscriptions.Load More Videos')"
            :icon="['fas', 'arrow-down']"
            @click="loadUserPlaylistWindow(userWindow.offset + playlistItems.length)"
          />
        </component>
        <FtPrompt
          v-if="showRemoveWatchedVideosPrompt"
          autosize
          :label="removeWatchedVideosPromptLabel"
          :option-names="removeWatchedVideosPromptOptionNames"
          :option-values="REMOVE_WATCHED_VIDEOS_PROMPT_VALUES"
          is-first-option-destructive
          @click="handleRemoveWatchedVideosPromptAnswer"
        />
        <p
          v-if="playlistUnavailableVideoCount > 0"
        >
          {{ t('Video.Playlist.Unavailable videos are hidden', { count: playlistUnavailableVideoCount }, playlistUnavailableVideoCount) }}
        </p>
      </div>
    </template>
  </FtCard>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, TransitionGroup, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FtLoader from '../FtLoader/FtLoader.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtListVideoNumbered from '../FtListVideoNumbered/FtListVideoNumbered.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'
import { DBLibraryHandlers } from '../../../datastores/handlers/index'
import { usePlaylistStatistics } from '../../composables/usePlaylistStatistics'
import FtButton from '../FtButton/FtButton.vue'

import { deepCopy, extractNumberFromString, getVideoThumbnailUrl, showApiErrorToast, showToast, throttle } from '../../helpers/utils'
import {
  getLocalCachedFeedContinuation,
  getLocalPlaylist,
  parseLocalPlaylistVideos,
  untilEndOfLocalPlayList,
} from '../../helpers/api/local'
import { invidiousGetPlaylistInfo } from '../../helpers/api/invidious'
import { isHistoryEntryWatched } from '../../helpers/history'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { getPlaylistSkipAvailability, getSortedPlaylistItems, SORT_BY_VALUES } from '../../helpers/playlists'
import { useTabContext } from '../../tabs/TabContext'

const props = defineProps({
  playlistId: {
    type: String,
    required: true,
  },
  playlistType: {
    type: String,
    default: null
  },
  videoId: {
    type: String,
    required: true,
  },
  playlistItemId: {
    type: String,
    default: null,
  },
  libraryMemberId: { type: String, default: null },
  downloadId: {
    type: String,
    default: '',
  },
  watchViewLoading: {
    type: Boolean,
    required: true,
  },
  autoSkipUnavailable: {
    type: Boolean,
    default: false,
  },
  fullscreenOverlay: {
    type: Boolean,
    default: false,
  },
  phonePanel: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'pause-player', 'skip-availability-change', 'upcoming-videos-change'])

const { locale, t } = useI18n()
const phonePanelHeader = inject('phonePanelHeader', null)
const router = useRouter()
const { tabId, isTabPresented } = useTabContext()
const playlistCacheTabId = tabId ?? 'web'

// Retry centering once a hidden tab or phone panel has a measurable list.
const needsInitialCenter = ref(false)

const isLoading = ref(false)
const isFetchingPlaylistContinuation = ref(false)
const hasUnloadedPlaylistVideos = ref(false)
const isCollapsed = ref(false)
const playlistCollapsed = computed(() => isCollapsed.value && !props.fullscreenOverlay && !props.phonePanel)
let savedScrollTop = 0
let lastScrolledVideoId = null
const shuffleEnabled = ref(false)
const loopEnabled = ref(false)
const reversePlaylist = ref(false)
const showRemoveWatchedVideosPrompt = ref(false)
const channelId = ref('')
const channelName = ref('')
const playlistTitle = ref('')
const playlistTotalVideoCount = ref(0)
const playlistItems = shallowRef([])
const randomizedPlaylistItems = shallowRef([])
const skippedUnavailableItems = new Set()
let expectedAutoSkipItem = null
/** @import { VideoData } from '../../helpers/dragAndDrop' */
/** @type {import('vue').Ref<VideoData>} */
const draggedVideo = ref({ videoId: null, playlistItemId: null })
const showProgressBarPreview = ref(false)
const previewPositionPixels = ref(0)
const previewVideoIndex = ref(1)
const userPreviewVideo = shallowRef(null)
let userPreviewGeneration = 0

const prevVideoBeforeDeletion = ref(null)
let getPlaylistInfoRun = false
let previewAnimationFrame = null
let previewPointerClientX = 0

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

const thumbnailPreference = computed(() => store.getters.getThumbnailPreference)

const isUserPlaylist = computed(() => props.playlistType === 'user')
const isPagedPlaylist = computed(() => process.env.IS_ELECTRON && isUserPlaylist.value)
const userWindow = shallowRef({ offset: 0, index: -1, total: 0, revision: 0, next: null, previous: null })
const userShuffleSeed = ref('')
let userShuffleAnchor = null
let userWindowGeneration = 0
const userStatistics = usePlaylistStatistics(store, () => props.playlistId, () => isPagedPlaylist.value)
const userAnchor = () => ({ memberId: props.libraryMemberId, itemId: props.playlistItemId, videoId: props.videoId })

const playlistReverseStateKey = computed(() => {
  if (props.playlistId == null || props.playlistId === '') { return null }

  return `${props.playlistType ?? 'default'}:${props.playlistId}`
})

const playlistReverseStates = computed(() => store.getters.getPlaylistReverseStates)

const storedReversePlaylist = computed(() => {
  const key = playlistReverseStateKey.value
  if (key == null) { return false }

  return playlistReverseStates.value?.[key] === true
})

/** @type {import('vue').ComputedRef<boolean>} */
const userPlaylistsReady = computed(() => store.getters.getPlaylistsReady)

const selectedUserPlaylist = computed(() => {
  if (props.playlistId == null || props.playlistId === '') { return null }

  return store.getters.getPlaylist(props.playlistId)
})

const quickBookmarkPlaylistId = computed(() => store.getters.getQuickBookmarkTargetPlaylistId)

const quickBookmarkButtonEnabled = computed(() => {
  if (selectedUserPlaylist.value == null) { return true }

  return selectedUserPlaylist.value._id !== quickBookmarkPlaylistId.value
})

/** @type {import('vue').ComputedRef<number | undefined>} */
const selectedUserPlaylistVideoCount = computed(() => selectedUserPlaylist.value?.videoCount ?? selectedUserPlaylist.value?.videos?.length)

/** @type {import('vue').ComputedRef<number | undefined>} */
const selectedUserPlaylistLastUpdatedAt = computed(() => selectedUserPlaylist.value?.lastUpdatedAt)

const userPlaylistWatchedVideoCount = computed(() => {
  if (!isUserPlaylist.value) { return 0 }
  if (isPagedPlaylist.value) return userStatistics.value.watchedCount

  const historyCacheById = store.getters.getHistoryCacheById
  return selectedUserPlaylist.value?.videos.reduce((count, video) => {
    return isHistoryEntryWatched(historyCacheById[video.videoId]) ? count + 1 : count
  }, 0) ?? 0
})

const removeWatchedVideosPromptLabel = computed(() => {
  return t(
    'User Playlists.Are you sure you want to remove {playlistItemCount} watched videos from this playlist? This cannot be undone',
    { playlistItemCount: userPlaylistWatchedVideoCount.value },
    userPlaylistWatchedVideoCount.value
  )
})

const removeWatchedVideosPromptOptionNames = computed(() => [
  t('Yes, Delete'),
  t('Cancel')
])

const REMOVE_WATCHED_VIDEOS_PROMPT_VALUES = ['delete', 'cancel']

const currentVideoIndexZeroBased = computed(() => {
  return findIndexOfCurrentVideoInPlaylist(playlistItems.value)
})

const currentVideoIndexOneBased = computed(() => isPagedPlaylist.value ? userWindow.value.index + 1 : currentVideoIndexZeroBased.value + 1)

const currentVideo = computed(() => playlistItems.value[currentVideoIndexZeroBased.value])

const playlistVideoCount = computed(() => isPagedPlaylist.value ? userWindow.value.total : playlistItems.value.length)

const playlistUnavailableVideoCount = computed(() => hasUnloadedPlaylistVideos.value
  ? 0
  : playlistTotalVideoCount.value - playlistVideoCount.value)

const videoIndexInPlaylistItems = computed(() => {
  if (isPagedPlaylist.value) return userWindow.value.index
  const items = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  return findIndexOfCurrentVideoInPlaylist(items)
})

const videoIsLastPlaylistItem = computed(() => {
  return videoIndexInPlaylistItems.value === (playlistVideoCount.value - 1)
})

const videoIsNotPlaylistItem = computed(() => videoIndexInPlaylistItems.value === -1)

const isWaitingForNextVideo = computed(() => isFetchingPlaylistContinuation.value && videoIsLastPlaylistItem.value)

const nextVideo = computed(() => {
  if (isPagedPlaylist.value) return userWindow.value.next
  if (isWaitingForNextVideo.value) return null
  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  const targetVideoIndex = (videoIsNotPlaylistItem.value || videoIsLastPlaylistItem.value)
    ? 0
    : videoIndexInPlaylistItems.value + 1

  return targetList[targetVideoIndex] ?? null
})

const upcomingVideos = computed(() => {
  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  const currentIndex = findIndexOfCurrentVideoInPlaylist(targetList)
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1
  const remainingVideos = targetList.slice(startIndex)

  return loopEnabled.value && !isFetchingPlaylistContinuation.value && currentIndex !== -1
    ? remainingVideos.concat(targetList.slice(0, startIndex))
    : remainingVideos
})

watch([upcomingVideos, isFetchingPlaylistContinuation], ([videos]) => {
  emit('upcoming-videos-change', videos)
}, { immediate: true, flush: 'post' })

const playlistPageLinkTo = computed(() => ({
  path: `/playlist/${props.playlistId}`,
  query: {
    playlistType: isUserPlaylist.value ? 'user' : '',
  }
}))

/** @type {import('vue').ComputedRef<string>} */
const userPlaylistSortOrder = computed(() => store.getters.getUserPlaylistSortOrder)

const sortOrder = computed(() => isUserPlaylist.value ? userPlaylistSortOrder.value : SORT_BY_VALUES.Custom)

const isSortOrderCustom = computed(() => sortOrder.value === SORT_BY_VALUES.Custom)

const canMoveVideos = computed(() => {
  return isUserPlaylist.value && isSortOrderCustom.value && (isPagedPlaylist.value ? userWindow.value.total : playlistItems.value.length) > 1
})

const MAX_ENHANCED_PLAYLIST_ITEMS = 200
const animatePlaylistItems = computed(() => {
  return canMoveVideos.value && playlistItems.value.length < MAX_ENHANCED_PLAYLIST_ITEMS
})

// TransitionGroup runs FLIP layout measurements for every child whenever this
// component updates. The fullscreen dock changes this component's layout, so a
// large playlist would synchronously measure thousands of items just to open or
// close. Retain move animations only where that cost stays bounded.
const playlistItemsWrapperComponent = computed(() => animatePlaylistItems.value ? TransitionGroup : 'div')

const isVideoDragging = computed(() => {
  const { videoId, playlistItemId } = draggedVideo.value

  return videoId != null && playlistItemId != null
})

const previewStyle = computed(() => ({
  left: `${previewPositionPixels.value}px`,
  transform: 'none'
}))

const previewVideoTitle = computed(() => {
  if (isPagedPlaylist.value) return userPreviewVideo.value?.title ?? ''
  const index = previewVideoIndex.value - 1

  if (index >= 0 && index < playlistItems.value.length) {
    return playlistItems.value[index].title || 'Unknown Title'
  }
  return ''
})

const previewVideoThumbnail = computed(() => {
  if (isPagedPlaylist.value) return userPreviewVideo.value?.videoId ? getVideoThumbnailUrl(userPreviewVideo.value.videoId, backendPreference.value, currentInvidiousInstanceUrl.value, thumbnailPreference.value) : null
  const index = previewVideoIndex.value - 1

  if (index >= 0 && index < playlistItems.value.length) {
    const videoId = playlistItems.value[index].videoId

    if (videoId) {
      const baseUrl = backendPreference.value === 'invidious'
        ? currentInvidiousInstanceUrl.value
        : 'https://i.ytimg.com'
      return `${baseUrl}/vi/${videoId}/default.jpg`
    }
  }

  return null
})

watch(userPlaylistsReady, () => {
  getPlaylistInfoWithDelay()
})

watch(selectedUserPlaylistVideoCount, () => {
  // Re-fetch from local store when current user playlist updated
  parseUserPlaylist(selectedUserPlaylist.value)
  shufflePlaylistItems()
})

watch(selectedUserPlaylistLastUpdatedAt, () => {
  // Re-fetch from local store when current user playlist updated
  parseUserPlaylist(selectedUserPlaylist.value)
})

watch(() => props.videoId, (newId, oldId) => {
  // Check if next video is from the shuffled list or if the user clicked a different video
  // Automatic skips retain one order until playback succeeds or every entry has failed.
  if (!isPagedPlaylist.value && shuffleEnabled.value && expectedAutoSkipItem !== (props.playlistItemId || newId)) {
    const newVideoIndex = randomizedPlaylistItems.value.findIndex((item) => {
      return item.videoId === newId
    })

    const oldVideoIndex = randomizedPlaylistItems.value.findIndex((item) => {
      return item.videoId === oldId
    })

    if ((newVideoIndex - 1) !== oldVideoIndex) {
      // User clicked a different video than expected. Re-shuffle the list
      shufflePlaylistItems()
    }
  }
})

function playlistItemKey(item) {
  return item?._libraryMemberId || item?.playlistItemId || item?.videoId || null
}

function currentPlaylistItemKey() {
  return props.libraryMemberId || (isPagedPlaylist.value ? currentVideo.value?._libraryMemberId : null) || props.playlistItemId || props.videoId
}

function resetUnavailableSkipChain() {
  skippedUnavailableItems.clear()
  expectedAutoSkipItem = null
}

// Route membership arrives before Watch finishes copying video/item IDs.
// Observe one identity transition rather than resetting again for those copies.
watch(currentPlaylistItemKey, currentKey => {
  if (expectedAutoSkipItem !== currentKey) resetUnavailableSkipChain()
  expectedAutoSkipItem = null
}, { flush: 'post' })

watch(() => props.playlistItemId, () => {
  prevVideoBeforeDeletion.value = null
})

watch(
  [isLoading, () => props.watchViewLoading, currentVideoIndexZeroBased],
  ([playlistLoading, watchViewLoading]) => {
    if (!playlistLoading && !watchViewLoading) {
      // Wait until both the watch view and playlist items are visible before
      // measuring them. The current index also changes when playback advances.
      centerCurrentVideo()
    }
  },
  { flush: 'post' }
)

// A playlist opened in a background tab centers while hidden, so it lands at the
// top. Re-center the current video the first time the tab is presented.
if (isTabPresented != null) {
  watch(isTabPresented, (presented) => {
    if (presented && needsInitialCenter.value) {
      centerCurrentVideo()
    }
  })
}

watch(() => props.playlistId, () => {
  if (isPagedPlaylist.value) { parseUserPlaylist(selectedUserPlaylist.value); return }
  isFetchingPlaylistContinuation.value = false
  hasUnloadedPlaylistVideos.value = false
  resetUnavailableSkipChain()
  reversePlaylist.value = storedReversePlaylist.value

  if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    getPlaylistInformationInvidious()
  } else {
    getPlaylistInformationLocal()
  }
})

watch(storedReversePlaylist, (newVal) => {
  if (reversePlaylist.value !== newVal) {
    reversePlaylist.value = newVal
    if (isPagedPlaylist.value) parseUserPlaylist(selectedUserPlaylist.value)
    else playlistItems.value = playlistItems.value.toReversed()
  }
})

onMounted(() => {
  reversePlaylist.value = storedReversePlaylist.value

  if (isPagedPlaylist.value) {
    store.commit('setCachedPlaylist', { tabId: playlistCacheTabId, value: null })
    getPlaylistInfoWithDelay()
    return
  }

  const cachedPlaylist = store.getters.getCachedPlaylist(playlistCacheTabId)

  if (cachedPlaylist?.id === props.playlistId) {
    loadCachedPlaylistInformation(cachedPlaylist)
  } else {
    getPlaylistInfoWithDelay()
  }
})

/**
 * @param {any[]} videoList
 */
function findIndexOfCurrentVideoInPlaylist(videoList) {
  if (props.libraryMemberId) {
    const index = videoList.findIndex(item => item._libraryMemberId === props.libraryMemberId)
    if (index !== -1) return index
    if (prevVideoBeforeDeletion.value?._libraryMemberId) return videoList.findIndex(item => item._libraryMemberId === prevVideoBeforeDeletion.value._libraryMemberId)
    return -1
  }
  const playlistItemId = props.playlistItemId
  const videoId = props.videoId
  const prevVideoBeforeDeletionPlaylistItemId = prevVideoBeforeDeletion.value?.playlistItemId
  const prevVideoBeforeDeletionPlaylistVideoId = prevVideoBeforeDeletion.value?.videoId

  return videoList.findIndex((item) => {
    if (item.playlistItemId && (playlistItemId || prevVideoBeforeDeletionPlaylistItemId)) {
      return item.playlistItemId === playlistItemId || item.playlistItemId === prevVideoBeforeDeletionPlaylistItemId
    } else if (item.videoId) {
      return item.videoId === videoId || item.videoId === prevVideoBeforeDeletionPlaylistVideoId
    } else if (item.id) {
      return item.id === videoId || item.id === prevVideoBeforeDeletionPlaylistVideoId
    }

    return false
  })
}

function getPlaylistInfoWithDelay() {
  if (getPlaylistInfoRun) { return }

  isLoading.value = true
  // `selectedUserPlaylist` result accuracy relies on data being ready
  if (isUserPlaylist.value && !userPlaylistsReady.value) { return }

  getPlaylistInfoRun = true

  if (selectedUserPlaylist.value != null) {
    parseUserPlaylist(selectedUserPlaylist.value)
  } else if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    getPlaylistInformationInvidious()
  } else {
    getPlaylistInformationLocal()
  }
}

function saveScrollState() {
  savedScrollTop = getScrollTop()
  lastScrolledVideoId = props.videoId
}

function restoreScrollState() {
  if (lastScrolledVideoId !== props.videoId) {
    centerCurrentVideo()
  } else {
    restoreScrollTop(savedScrollTop)
  }
}

watch(isCollapsed, (collapsed) => {
  if (collapsed) {
    saveScrollState()
  } else {
    restoreScrollState()
  }
})

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function toggleLoop() {
  if (loopEnabled.value) {
    loopEnabled.value = false
    showToast({ message: t('Loop is now disabled'), icon: ['fas', 'retweet'] })
  } else {
    loopEnabled.value = true
    showToast({ message: t('Loop is now enabled'), icon: ['fas', 'retweet'] })
  }
}

function toggleShuffle() {
  if (shuffleEnabled.value) {
    shuffleEnabled.value = false
    showToast({ message: t('Shuffle is now disabled'), icon: ['fas', 'random'] })
  } else {
    shuffleEnabled.value = true
    showToast({ message: t('Shuffle is now enabled'), icon: ['fas', 'random'] })
    shufflePlaylistItems()
  }
  if (isPagedPlaylist.value) parseUserPlaylist(selectedUserPlaylist.value)
}

function toggleReversePlaylist() {
  isLoading.value = true
  showToast({ message: t('The playlist has been reversed'), icon: ['fas', 'exchange-alt'] })

  reversePlaylist.value = !reversePlaylist.value
  persistReversePlaylistState()
  // Create a new array to avoid changing array in data store state
  // it could be user playlist or cache playlist
  if (isPagedPlaylist.value) { parseUserPlaylist(selectedUserPlaylist.value); return }
  playlistItems.value = playlistItems.value.toReversed()

  nextTick(() => {
    isLoading.value = false
  })
}

function persistReversePlaylistState() {
  const key = playlistReverseStateKey.value
  if (key == null) { return }

  const updatedPlaylistReverseStates = { ...(playlistReverseStates.value ?? {}) }
  if (reversePlaylist.value) {
    updatedPlaylistReverseStates[key] = true
  } else {
    delete updatedPlaylistReverseStates[key]
  }

  store.dispatch('updatePlaylistReverseStates', updatedPlaylistReverseStates)
}

/**
 * @param {any[]} items
 */
function applyReversePlaylistState(items) {
  return reversePlaylist.value ? items.toReversed() : items
}

/**
 * @param {any[]} items
 */
async function persistPlaylistOrder(items) {
  const selectedPlaylist = selectedUserPlaylist.value
  if (selectedPlaylist == null) { return }
  if (isPagedPlaylist.value) {
    try {
      await DBLibraryHandlers.query('reorderPlaylistMembers', { id: props.playlistId, memberIds: (reversePlaylist.value ? items.toReversed() : items).map(item => item._libraryMemberId), revision: userWindow.value.revision })
      await store.dispatch('grabAllPlaylists')
      await loadUserPlaylistWindow()
    } catch (error) { console.error(error); await loadUserPlaylistWindow() }
    return
  }

  const playlist = {
    playlistName: selectedPlaylist.playlistName,
    protected: selectedPlaylist.protected,
    description: selectedPlaylist.description,
    videos: deepCopy(reversePlaylist.value ? items.toReversed() : items),
    _id: selectedPlaylist._id,
  }

  try {
    await store.dispatch('updatePlaylist', playlist)
  } catch (error) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(error)
  }
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 * @param {-1 | 1} offset
 */
async function moveVideo(videoId, playlistItemId, offset, memberId) {
  if (isPagedPlaylist.value) {
    const item = playlistItems.value.find(item => memberId ? item._libraryMemberId === memberId : item.videoId === videoId && item.playlistItemId === playlistItemId)
    if (!item) return
    try {
      await DBLibraryHandlers.query('movePlaylistMember', { id: props.playlistId, memberId: item._libraryMemberId, direction: reversePlaylist.value ? -offset : offset, revision: userWindow.value.revision })
      await store.dispatch('grabAllPlaylists')
      await loadUserPlaylistWindow()
    } catch (error) { console.error(error); await loadUserPlaylistWindow() }
    return
  }
  const items = playlistItems.value.slice()
  const index = items.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })
  const targetIndex = index + offset

  if (index === -1 || targetIndex < 0 || targetIndex >= items.length) { return }

  [items[index], items[targetIndex]] = [items[targetIndex], items[index]]
  playlistItems.value = items
  persistPlaylistOrder(items)
}

function moveVideoUp(videoId, playlistItemId, memberId) {
  moveVideo(videoId, playlistItemId, -1, memberId)
}

function moveVideoDown(videoId, playlistItemId, memberId) {
  moveVideo(videoId, playlistItemId, 1, memberId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
async function removeVideoFromPlaylist(videoId, playlistItemId, memberId) {
  try {
    await store.dispatch('removeVideo', {
      _id: props.playlistId,
      videoId,
      playlistItemId,
      memberId,
    })
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.Video has been removed'),
      image: getVideoThumbnailUrl(videoId, backendPreference.value, currentInvidiousInstanceUrl.value, thumbnailPreference.value),
      icon: ['fas', 'trash'],
    })
  } catch (error) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.There was a problem with removing this video'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(error)
  }
}

/** @param {'delete' | 'cancel' | null} option */
async function handleRemoveWatchedVideosPromptAnswer(option) {
  showRemoveWatchedVideosPrompt.value = false
  if (option !== 'delete' || selectedUserPlaylist.value == null) { return }

  if (isPagedPlaylist.value) {
    await DBLibraryHandlers.query('cleanupPlaylist', { id: props.playlistId, mode: 'watched' })
    await store.dispatch('grabAllPlaylists')
    await store.dispatch('grabHistory')
    return
  }
  const historyCacheById = store.getters.getHistoryCacheById
  const watchedVideos = selectedUserPlaylist.value.videos
    .filter((video) => isHistoryEntryWatched(historyCacheById[video.videoId]))
  const playlistItemIds = watchedVideos.map((video) => video.playlistItemId)

  if (playlistItemIds.length === 0) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There were no videos to remove."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  try {
    await store.dispatch('removeVideos', {
      _id: props.playlistId,
      playlistItemIds,
      videoIds: watchedVideos.map((video) => video.videoId),
    })
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.{videoCount} video(s) have been removed', {
        videoCount: playlistItemIds.length
      }, playlistItemIds.length),
      icon: ['fas', 'trash'],
    })
  } catch (error) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(error)
  }
}

/** @param {VideoData} video */
function setDraggedVideo(video) {
  draggedVideo.value = video
}

function onDragVideoEnd() {
  persistPlaylistOrder(playlistItems.value)
  setDraggedVideo({ videoId: null, playlistItemId: null })
}

/**
 * @param {VideoData} draggedOverVideo
 * @param {VideoData} draggedVideo_
 */
function moveDraggedVideoTemporarily(draggedOverVideo, draggedVideo_) {
  const items = playlistItems.value.slice()
  const draggedOverIndex = items.findIndex((video) => {
    return video.videoId === draggedOverVideo.videoId && video.playlistItemId === draggedOverVideo.playlistItemId
  })
  const draggedVideoIndex = items.findIndex((video) => {
    return video.videoId === draggedVideo_.videoId && video.playlistItemId === draggedVideo_.playlistItemId
  })

  if (draggedOverIndex === -1 || draggedVideoIndex === -1) { return }

  const [itemToMove] = items.splice(draggedVideoIndex, 1)
  items.splice(draggedOverIndex, 0, itemToMove)
  playlistItems.value = items
}

const moveDraggedVideoTemporarilyThrottled = throttle(moveDraggedVideoTemporarily, 100)

/**
 * @param {VideoData} video
 * @param {VideoData} source
 */
function onMoveDraggedVideo(video, source) {
  // Pointer drags already wait for transitions and flush their final target.
  if (source.pointerDragging) moveDraggedVideoTemporarily(video, source)
  else moveDraggedVideoTemporarilyThrottled(video, source)
}

function playNextVideo() {
  if (isPagedPlaylist.value) {
    if (!canPlayNextVideo.value) { showToast({ message: t('The playlist has ended. Enable loop to continue playing'), icon: ['fas', 'retweet'] }); return }
    const next = userWindow.value.next
    if (shuffleEnabled.value && (userWindow.value.index < 0 || userWindow.value.index === userWindow.value.total - 1) && expectedAutoSkipItem === null) {
      userShuffleSeed.value = crypto.randomUUID()
      userShuffleAnchor = { memberId: next?._libraryMemberId }
    }
    playUserPlaylistItem(next)
    showToast({ message: t('Playing Next Video'), icon: ['fas', 'step-forward'] })
    return
  }
  if (isWaitingForNextVideo.value) return
  const videoIndex = videoIndexInPlaylistItems.value
  const targetVideoIndex = (videoIsNotPlaylistItem.value || videoIsLastPlaylistItem.value) ? 0 : videoIndex + 1

  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  const targetPlaylistItem = targetList[targetVideoIndex]

  if (!targetPlaylistItem?.videoId) {
    return
  }

  const routerPushPayload = {
    path: `/watch/${targetPlaylistItem.videoId}`,
    query: {
      playlistId: props.playlistId,
      playlistType: props.playlistType,
      playlistItemId: targetPlaylistItem.playlistItemId,
      ...(props.downloadId ? { downloadId: props.downloadId } : {})
    }
  }

  if (shuffleEnabled.value) {
    let doShufflePlaylistItems = false

    if (videoIsLastPlaylistItem.value && !loopEnabled.value) {
      showToast({ message: t('The playlist has ended. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
      return
    }
    // loopEnabled = true
    if (videoIsLastPlaylistItem.value || videoIsNotPlaylistItem.value) {
      doShufflePlaylistItems = true
    }

    router.push(routerPushPayload)

    showToast({ message: t('Playing Next Video'), icon: ['fas', 'step-forward'] })

    if (doShufflePlaylistItems && expectedAutoSkipItem === null) {
      shufflePlaylistItems()
    }
  } else {
    const stopDueToLoopDisabled = videoIsLastPlaylistItem.value && !loopEnabled.value

    if (stopDueToLoopDisabled) {
      showToast({ message: t('The playlist has ended. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
      return
    }

    router.push(routerPushPayload)
    showToast({ message: t('Playing Next Video'), icon: ['fas', 'step-forward'] })
  }
}

function playPreviousVideo() {
  if (isPagedPlaylist.value) {
    if (canPlayPreviousVideo.value) playUserPlaylistItem(userWindow.value.previous)
    return
  }
  // At the start of the playlist there is nothing to go back to, unless loop wraps us around
  if (!canPlayPreviousVideo.value) {
    showToast({ message: t('The playlist is at the beginning. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
    return
  }

  const videoIndex = previousVideoSourceIndex.value

  // Wrap around to the end of the playlist only if there are no remaining earlier videos
  const targetVideoIndex = (videoIndex === 0 || videoIsNotPlaylistItem.value) ? playlistItems.value.length - 1 : videoIndex - 1

  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  const targetPlaylistItem = targetList[targetVideoIndex]

  if (!targetPlaylistItem?.videoId) {
    return
  }

  showToast({ message: t('Playing Previous Video'), icon: ['fas', 'step-backward'] })

  router.push(
    {
      path: `/watch/${targetPlaylistItem.videoId}`,
      query: {
        playlistId: props.playlistId,
        playlistType: props.playlistType,
        playlistItemId: targetPlaylistItem.playlistItemId,
        ...(props.downloadId ? { downloadId: props.downloadId } : {})
      }
    }
  )
}

/**
 * @param {{ id: string, title: string, channelName: string, channelId: string, items: VideoData[], continuationData: string | null }} cachedPlaylist
 */
async function loadCachedPlaylistInformation(cachedPlaylist) {
  getPlaylistInfoRun = true
  store.commit('setCachedPlaylist', { tabId: playlistCacheTabId, value: null })

  playlistTitle.value = cachedPlaylist.title
  playlistTotalVideoCount.value = cachedPlaylist.totalVideoCount
  channelName.value = cachedPlaylist.channelName
  channelId.value = cachedPlaylist.channelId

  hasUnloadedPlaylistVideos.value = process.env.SUPPORTS_LOCAL_API && backendPreference.value !== 'invidious' && cachedPlaylist.continuationData !== null
  isFetchingPlaylistContinuation.value = hasUnloadedPlaylistVideos.value

  // Playback must not wait for later pages when the next video is already cached.
  const videos = cachedPlaylist.items.slice()
  playlistItems.value = applyReversePlaylistState(videos.slice())
  isLoading.value = false

  if (!isFetchingPlaylistContinuation.value) return

  try {
    const continuationData = await getLocalCachedFeedContinuation('playlist', cachedPlaylist.continuationData)
    await untilEndOfLocalPlayList(continuationData, (p) => {
      if (props.playlistId !== cachedPlaylist.id) return
      const newVideos = parseLocalPlaylistVideos(p.items)
      videos.push(...newVideos)
      playlistItems.value = applyReversePlaylistState(videos.slice())
      if (shuffleEnabled.value) {
        // Keep the established shuffle order, including entries already played.
        randomizedPlaylistItems.value = randomizedPlaylistItems.value.concat(shuffleItems(newVideos.slice()))
      }
    })
    if (props.playlistId === cachedPlaylist.id) hasUnloadedPlaylistVideos.value = false
  } catch (err) {
    if (props.playlistId !== cachedPlaylist.id) return
    console.error(err)
    showApiErrorToast(t('Local API Error (Click to copy)'), err)
  } finally {
    if (props.playlistId === cachedPlaylist.id) isFetchingPlaylistContinuation.value = false
  }
}

async function getPlaylistInformationLocal() {
  isLoading.value = true

  try {
    const playlist = await getLocalPlaylist(props.playlistId)

    let channelName_

    if (playlist.info.author) {
      channelName_ = playlist.info.author.name
    } else {
      const subtitle = playlist.info.subtitle.toString()

      const index = subtitle.lastIndexOf('•')
      channelName_ = subtitle.substring(0, index).trim()
    }

    playlistTitle.value = playlist.info.title
    playlistTotalVideoCount.value = extractNumberFromString(playlist.info.total_items)
    channelName.value = channelName_
    channelId.value = playlist.info.author?.id

    const videos = []
    await untilEndOfLocalPlayList(playlist, (p) => {
      videos.push(...parseLocalPlaylistVideos(p.items))
    })

    playlistItems.value = applyReversePlaylistState(videos)

    isLoading.value = false
  } catch (err) {
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      getPlaylistInformationInvidious()
    } else {
      isLoading.value = false
    }
  }
}

async function getPlaylistInformationInvidious() {
  isLoading.value = true

  try {
    const result = await invidiousGetPlaylistInfo(props.playlistId)

    playlistTitle.value = result.title
    playlistTotalVideoCount.value = result.videoCount
    channelName.value = result.author
    channelId.value = result.authorId

    playlistItems.value = applyReversePlaylistState(result.videos)

    isLoading.value = false
  } catch (err) {
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'invidious' && backendFallback.value) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      getPlaylistInformationLocal()
    } else {
      isLoading.value = false
    }
  }
}

function parseUserPlaylist(playlist) {
  if (!playlist) return
  if (isPagedPlaylist.value) {
    playlistTitle.value = playlist.playlistName
    playlistTotalVideoCount.value = playlist.videoCount
    channelName.value = ''
    channelId.value = ''
    loadUserPlaylistWindow().catch(console.error)
    return
  }
  playlistTitle.value = playlist.playlistName
  channelName.value = ''
  channelId.value = ''

  const isCurrentVideoInParsedPlaylist = findIndexOfCurrentVideoInPlaylist(playlist.videos) !== -1
  if (!isCurrentVideoInParsedPlaylist) {
    // grab 2nd video if the 1st one is current & deleted
    // or the prior video in the list before the current video's deletion
    const targetVideoIndex = currentVideoIndexZeroBased.value - 1
    prevVideoBeforeDeletion.value = targetVideoIndex >= 0 ? playlistItems.value[targetVideoIndex] : null
  }

  playlistItems.value = getSortedPlaylistItems(playlist.videos, sortOrder.value, locale.value, reversePlaylist.value)

  isLoading.value = false
}

/** @param {VideoData[]} items */
function shuffleItems(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))

    const temp = items[i]
    items[i] = items[j]
    items[j] = temp
  }
  return items
}

function shufflePlaylistItems() {
  if (isPagedPlaylist.value) {
    userShuffleSeed.value = crypto.randomUUID()
    userShuffleAnchor = userAnchor()
    loadUserPlaylistWindow().catch(console.error)
    return
  }
  // Prevents the array from affecting the original object
  const items = playlistItems.value.slice()

  let cachedCurrentVideos

  if (currentVideo.value != null) {
    cachedCurrentVideos = items.splice(currentVideoIndexZeroBased.value, 1)
    // There is no else case
    // If current video is absent in (removed from) the playlist, nothing should be changed
  }

  shuffleItems(items)

  if (cachedCurrentVideos && cachedCurrentVideos.length > 0) {
    items.unshift(cachedCurrentVideos[0])
  }

  randomizedPlaylistItems.value = items
}

const playlistItemsWrapper = useTemplateRef('playlistItemsWrapper')
let playlistItemsObserver = null
let playlistItemsResizeObserver = null
let playlistItemsClampFrame = null

function stopObservingPlaylistItems() {
  playlistItemsObserver?.disconnect()
  playlistItemsObserver = null
  playlistItemsResizeObserver?.disconnect()
  playlistItemsResizeObserver = null
  if (playlistItemsClampFrame !== null) {
    cancelAnimationFrame(playlistItemsClampFrame)
    playlistItemsClampFrame = null
  }
}

watch(playlistItemsWrapper, (wrapper) => {
  stopObservingPlaylistItems()
  const container = wrapper?.$el ?? wrapper
  if (container == null) {
    return
  }

  const scheduleClamp = () => {
    playlistItemsClampFrame ??= requestAnimationFrame(() => {
      playlistItemsClampFrame = null
      const items = container.querySelectorAll(':scope > .playlistItem, :scope > .playlistPagination')
      clampOverlayScrollTop(
        container,
        items[items.length - 1] ?? null
      )
      if (needsInitialCenter.value && container.clientHeight > 0) {
        centerCurrentVideo()
      }
    })
  }
  playlistItemsObserver = new MutationObserver(scheduleClamp)
  playlistItemsObserver.observe(container, { childList: true })
  playlistItemsResizeObserver = new ResizeObserver(scheduleClamp)
  playlistItemsResizeObserver.observe(container)
}, { flush: 'post' })

onBeforeUnmount(stopObservingPlaylistItems)

function getScrollTop() {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
  return container?.scrollTop ?? 0
}

/** @param {number} scrollTop */
function setScrollTop(scrollTop) {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
  if (container != null) {
    container.scrollTop = scrollTop
  }
}

/** @param {number} scrollTop */
function restoreScrollTop(scrollTop) {
  nextTick(() => {
    requestAnimationFrame(() => {
      const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
      if (container != null) {
        restoreOverlayScrollTop(container, scrollTop)
      }
    })
  })
}

/**
 * @param {number} index
 */
/**
 * @param {number} index
 * @returns {boolean} whether the scroll could actually be applied. It cannot
 * when the tab is hidden (`display: none`), because the list then has no layout.
 */
function scrollToVideo(index) {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value

  if (container == null || container.clientHeight === 0) {
    return false
  }

  const currentVideoItemEl = container.querySelectorAll(':scope > .playlistItem')[index]

  if (currentVideoItemEl == null) {
    return false
  }

  const containerRect = container.getBoundingClientRect()
  const itemRect = currentVideoItemEl.getBoundingClientRect()
  const itemOffset = itemRect.top - containerRect.top - container.clientTop + container.scrollTop
  const centeredOffset = (container.clientHeight - itemRect.height) / 2

  restoreOverlayScrollTop(container, Math.max(0, itemOffset - centeredOffset))
  return true
}

function scrollToCurrentVideo() {
  return scrollToVideo(currentVideoIndexZeroBased.value)
}

function centerCurrentVideo() {
  nextTick(() => {
    requestAnimationFrame(async () => {
      const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
      const item = container?.querySelectorAll(':scope > .playlistItem')[currentVideoIndexZeroBased.value]
      // Move transitions can temporarily place a newly visible row outside the list.
      await Promise.allSettled((item?.getAnimations() ?? []).map(animation => animation.finished))
      if (scrollToCurrentVideo()) {
        needsInitialCenter.value = false
        requestAnimationFrame(scrollToCurrentVideo)
      } else {
        // Retry once the tab or phone panel becomes visible.
        needsInitialCenter.value = true
      }
    })
  })
}

function pausePlayer() {
  emit('pause-player')
}

const playlistProgressBar = useTemplateRef('playlistProgressBar')
const progressBarPreview = useTemplateRef('progressBarPreview')

/**
 * @param {MouseEvent} event
 */
function updateProgressBarPreview(event) {
  if (!showProgressBarPreview.value) return
  previewPointerClientX = event.clientX
  if (previewAnimationFrame !== null) return
  previewAnimationFrame = requestAnimationFrame(renderProgressBarPreview)
}

async function renderProgressBarPreview() {
  previewAnimationFrame = null
  if (!showProgressBarPreview.value || !playlistProgressBar.value) return

  const rect = playlistProgressBar.value.getBoundingClientRect()
  const clientX = previewPointerClientX
  const mouseX = clientX - rect.left
  const progressBarWidth = rect.width
  const percentage = Math.max(0, Math.min(100, (mouseX / progressBarWidth) * 100))

  previewVideoIndex.value = Math.max(1, Math.min(playlistVideoCount.value, Math.ceil((percentage / 100) * playlistVideoCount.value)))
  await nextTick()
  if (!showProgressBarPreview.value || !playlistProgressBar.value) return

  const boundary = playlistProgressBar.value.closest('.watchVideoPlaylist')
  if (boundary && progressBarPreview.value) {
    const boundaryRect = boundary.getBoundingClientRect()
    const margin = 8
    const availableWidth = Math.max(0, boundaryRect.width - (margin * 2))
    progressBarPreview.value.style.setProperty(
      '--playlist-preview-max-inline-size',
      `${availableWidth}px`
    )
    const previewWidth = Math.min(progressBarPreview.value.offsetWidth, availableWidth)
    const minimumViewportLeft = boundaryRect.left + margin
    const maximumViewportLeft = boundaryRect.right - margin - previewWidth
    const centeredViewportLeft = clientX - (previewWidth / 2)
    const viewportLeft = Math.max(
      minimumViewportLeft,
      Math.min(maximumViewportLeft, centeredViewportLeft)
    )
    previewPositionPixels.value = viewportLeft - rect.left
  }
}

watch(showProgressBarPreview, shown => {
  if (!shown) cancelProgressBarPreview()
})

function cancelProgressBarPreview() {
  if (previewAnimationFrame !== null) cancelAnimationFrame(previewAnimationFrame)
  previewAnimationFrame = null
}

onBeforeUnmount(cancelProgressBarPreview)

/**
 * @param {PointerEvent} event
 */
async function handleProgressBarClick(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const progressBarWidth = rect.width
  const clickPercentage = clickX / progressBarWidth

  const targetVideoIndex = Math.max(1, Math.min(playlistVideoCount.value, Math.ceil(clickPercentage * playlistVideoCount.value)))
  const targetArrayIndex = targetVideoIndex - 1

  if (isPagedPlaylist.value) {
    await loadUserPlaylistWindow(Math.max(0, targetArrayIndex - 20))
    await nextTick()
    scrollToVideo(targetArrayIndex - userWindow.value.offset)
    return
  }
  if (targetArrayIndex >= 0 && targetArrayIndex < playlistItems.value.length) {
    scrollToVideo(targetArrayIndex)
  }
}

const videoIsLastInInPlaylistItems = computed(() => {
  if (isPagedPlaylist.value) return userWindow.value.index === userWindow.value.total - 1
  if (shuffleEnabled.value) {
    return videoIndexInPlaylistItems.value === randomizedPlaylistItems.value.length - 1
  } else {
    return videoIndexInPlaylistItems.value === playlistItems.value.length - 1
  }
})

const shouldStopDueToPlaylistEnd = computed(() => {
  // Loop enabled = should not stop
  return videoIsLastInInPlaylistItems.value && !loopEnabled.value && !isFetchingPlaylistContinuation.value
})

/**
 * Index that `playPreviousVideo` steps back from.
 *
 * When the current video being watched in the playlist is deleted,
 * the previous video is shown as the "current" one.
 * So if we want to play the previous video, in this case,
 * we actually want to actually play the "current" video.
 * The only exception is when shuffle is enabled, as we don't actually
 * want to play the last sequential video with shuffle.
 */
const previousVideoSourceIndex = computed(() => {
  const videoIndex = videoIndexInPlaylistItems.value

  return prevVideoBeforeDeletion.value && !shuffleEnabled.value ? videoIndex + 1 : videoIndex
})

const skipAvailability = computed(() => {
  const items = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  return getPlaylistSkipAvailability({
    itemCount: isPagedPlaylist.value ? userWindow.value.total : items.length,
    currentIndex: videoIndexInPlaylistItems.value,
    loopEnabled: loopEnabled.value && !isFetchingPlaylistContinuation.value,
    previousVideoSourceIndex: previousVideoSourceIndex.value
  })
})

const canPlayNextVideo = computed(() => skipAvailability.value.canPlayNext)

const canPlayPreviousVideo = computed(() => skipAvailability.value.canPlayPrevious)

watch(
  [() => props.autoSkipUnavailable, isLoading, () => props.watchViewLoading, nextVideo, canPlayNextVideo],
  ([shouldSkip, playlistLoading, watchViewLoading, nextItem, canPlayNext]) => {
    if (!shouldSkip || playlistLoading || watchViewLoading || !canPlayNext) return

    const currentKey = currentPlaylistItemKey()
    const nextKey = playlistItemKey(nextItem)
    if (!nextKey || nextKey === currentKey || skippedUnavailableItems.has(currentKey) ||
      skippedUnavailableItems.has(nextKey)) return

    skippedUnavailableItems.add(currentKey)
    expectedAutoSkipItem = nextKey
    playNextVideo()
  },
  { flush: 'post' }
)

// The watch view owns the skip actions, as it also knows about the watch queue
watch([canPlayNextVideo, canPlayPreviousVideo], ([canPlayNext, canPlayPrevious]) => {
  emit('skip-availability-change', { canPlayNext, canPlayPrevious })
}, { immediate: true })

function userPlaylistWindowOptions(offset = null, limit = 100) {
  return { id: props.playlistId, sort: sortOrder.value, locale: locale.value, reverse: reversePlaylist.value, shuffleSeed: shuffleEnabled.value ? userShuffleSeed.value : '', shuffleAnchor: userShuffleAnchor, anchor: userAnchor(), offset, limit }
}
async function loadUserPlaylistWindow(offset = null) {
  const generation = ++userWindowGeneration
  let result = await DBLibraryHandlers.query('playlistWindow', userPlaylistWindowOptions(offset))
  if (result.index < 0 && userWindow.value.index >= 0 && userWindow.value.previous) {
    prevVideoBeforeDeletion.value = userWindow.value.previous
    result = await DBLibraryHandlers.query('playlistWindow', { ...userPlaylistWindowOptions(offset), anchor: { memberId: prevVideoBeforeDeletion.value._libraryMemberId } })
  } else if (result.index >= 0) prevVideoBeforeDeletion.value = null
  if (generation !== userWindowGeneration) return
  userWindow.value = result
  playlistItems.value = result.records
  isLoading.value = false
}
function playUserPlaylistItem(item) {
  if (!item?.videoId) return
  router.push({ path: `/watch/${item.videoId}`, query: { playlistId: props.playlistId, playlistType: props.playlistType, playlistItemId: item.playlistItemId, libraryMemberId: item._libraryMemberId, ...(props.downloadId ? { downloadId: props.downloadId } : {}) } })
}
watch([() => props.videoId, () => props.playlistItemId, () => props.libraryMemberId, sortOrder, locale], () => {
  if (isPagedPlaylist.value) loadUserPlaylistWindow().catch(console.error)
})
let userPreviewBusy = false
watch(previewVideoIndex, async () => {
  if (!isPagedPlaylist.value || !showProgressBarPreview.value) return
  userPreviewGeneration++
  if (userPreviewBusy) return
  userPreviewBusy = true
  try {
    while (showProgressBarPreview.value) {
      const generation = userPreviewGeneration
      const result = await DBLibraryHandlers.query('playlistWindow', userPlaylistWindowOptions(previewVideoIndex.value - 1, 1))
      if (generation === userPreviewGeneration) { userPreviewVideo.value = result.records[0] ?? null; break }
    }
  } catch (error) { console.error(error) } finally { userPreviewBusy = false }
})

defineExpose({
  centerCurrentVideo,
  getScrollTop,
  restoreScrollTop,
  setScrollTop,
  playNextVideo,
  resetUnavailableSkipChain,
  playPreviousVideo,
  nextVideo,
  shouldStopDueToPlaylistEnd,
  isFetchingPlaylistContinuation,
  isWaitingForNextVideo,
  getState: () => ({
    index: reversePlaylist.value
      ? playlistVideoCount.value - currentVideoIndexOneBased.value
      : (isPagedPlaylist.value ? userWindow.value.index : currentVideoIndexZeroBased.value),
    reverse: reversePlaylist.value,
    shuffle: shuffleEnabled.value,
    loop: loopEnabled.value
  })
})
</script>

<style scoped src="./WatchVideoPlaylist.css" />
