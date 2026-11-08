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
              {{ currentPlaylistPosition }} / {{ playlistVideoCount }}
            </label>

            <!-- eslint-disable vuejs-accessibility/mouse-events-have-key-events, vuejs-accessibility/click-events-have-key-events -->
            <div
              v-if="!playlistCollapsed"
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
                  :style="{ width: (currentPlaylistPosition / playlistVideoCount) * 100 + '%' }"
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
            :key="item.playlistItemId || item.videoId"
            ref="playlistItem"
            class="playlistItem"
            :data="item"
            :playlist-id="playlistId"
            :playlist-type="playlistType"
            :playlist-index="reversePlaylist ? playlistItems.length - index - 1 : index"
            :playlist-item-id="item.playlistItemId"
            :download-id="downloadId"
            :playlist-reverse="reversePlaylist"
            :playlist-shuffle="shuffleEnabled"
            :playlist-loop="loopEnabled"
            :video-index="reversePlaylist ? playlistItems.length - index - 1 : index"
            :is-current-video="playingVideoIndex === index"
            :can-move-video-up="index > 0 && canMoveVideos"
            :can-move-video-down="index < playlistItems.length - 1 && canMoveVideos"
            :can-remove-from-playlist="isUserPlaylist"
            :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
            :dragged-video="draggedVideo"
            :is-sort-order-custom="isSortOrderCustom"
            :is-video-dragging="isVideoDragging"
            appearance="watchPlaylistItem"
            nested-scroller
            :initial-visible-state="Math.abs(index - currentVideoIndexZeroBased) < 4 || (progressBarTargetIndex >= 0 && Math.abs(index - progressBarTargetIndex) < 4)"
            @drag-video="setDraggedVideo"
            @drag-video-end="onDragVideoEnd"
            @move-dragged-video="onMoveDraggedVideo"
            @move-video-up="moveVideoUp"
            @move-video-down="moveVideoDown"
            @move-video-to-the-top="(videoId, playlistItemId) => moveVideo(videoId, playlistItemId, () => 0)"
            @move-video-to-the-bottom="(videoId, playlistItemId) => moveVideo(videoId, playlistItemId, (index, lastIndex) => lastIndex)"
            @remove-from-playlist="removeVideoFromPlaylist"
            @pause-player="pausePlayer"
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
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, TransitionGroup, triggerRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FtLoader from '../FtLoader/FtLoader.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtListVideoNumbered from '../FtListVideoNumbered/FtListVideoNumbered.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import { usesInvidiousApi } from '../../../apiBackends'

import { getInvidiousApiErrorMessage, showInvidiousFallbackToast, deepCopy, extractNumberFromString, getVideoThumbnailUrl, showApiErrorToast, showToast, throttle } from '../../helpers/utils'
import {
  getLocalCachedFeedContinuation,
  getLocalPlaylist,
  getLocalPlaylistContinuation,
  parseLocalPlaylistVideos,
} from '../../helpers/api/local'
import { invidiousGetPlaylistInfo } from '../../helpers/api/invidious'
import { hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos } from '../../helpers/api/invidious-playlists'
import { navigationDownloadId } from '../../helpers/downloadPlayback'
import { isHistoryEntryWatched } from '../../helpers/history'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { getPlaylistSkipAvailability, getSortedPlaylistItems, isPlaylistSortOrder, SORT_BY_VALUES } from '../../helpers/playlists'
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

const emit = defineEmits(['close', 'pause-player', 'restart-current-video', 'skip-availability-change', 'unavailable-video-skipped', 'upcoming-videos-change'])

const { locale, t } = useI18n()
const phonePanelHeader = inject('phonePanelHeader', null)
const router = useRouter()
const { tabId, isTabPresented } = useTabContext()
const playlistCacheTabId = tabId ?? 'web'

// Retry centering once a hidden tab or phone panel has a measurable list.
const needsInitialCenter = ref(false)

const isLoading = ref(false)
const isFetchingPlaylistContinuation = ref(false)
// Later pages exist that have not loaded, including after a failed request.
const hasUnloadedPlaylistVideos = ref(false)
const playlistContinuationFailed = ref(false)
// Set when the panel shows its end or the progress bar picks an unloaded video.
const playlistPanelNearEnd = ref(false)
const requestedPlaylistVideoCount = ref(0)
/** @type {number | null} the progress bar position to scroll to once it loads */
let pendingProgressBarIndex = null
// Rows around the video picked on the progress bar render right away, like
// those around the current video, so they do not grow after centering it.
const progressBarTargetIndex = ref(-1)
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

const prevVideoBeforeDeletion = ref(null)
let getPlaylistInfoRun = false
// Bumped per playlist change so a request for an earlier visit of the same
// playlist cannot overwrite a later one.
let playlistLoadGeneration = 0
// Unmounting stops the playlist watcher, so abandon pending page loads here.
onBeforeUnmount(() => { playlistLoadGeneration += 1 })
let previewAnimationFrame = null
let previewPointerClientX = 0

/** @type {import('vue').ComputedRef<'local' | 'invidious' | 'yattee'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

const thumbnailPreference = computed(() => store.getters.getThumbnailPreference)

const isUserPlaylist = computed(() => props.playlistType === 'user')

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
const selectedUserPlaylistVideoCount = computed(() => selectedUserPlaylist.value?.videos?.length)

/** @type {import('vue').ComputedRef<number | undefined>} */
const selectedUserPlaylistLastUpdatedAt = computed(() => selectedUserPlaylist.value?.lastUpdatedAt)

const userPlaylistWatchedVideoCount = computed(() => {
  if (!isUserPlaylist.value) { return 0 }

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

// Unlike the index above, this ignores the stand-in for a removed playing video,
// so the queue does not highlight a video that is not playing.
const playingVideoIndex = computed(() => findIndexOfCurrentVideoInPlaylist(playlistItems.value, null))

const currentVideoIndexOneBased = computed(() => currentVideoIndexZeroBased.value + 1)

// Reversed playlists add later pages at the start, so videos still unloaded come before the loaded ones.
const currentPlaylistPosition = computed(() => currentVideoIndexOneBased.value +
  (reversePlaylist.value ? playlistVideoCount.value - playlistItems.value.length : 0))

const currentVideo = computed(() => playlistItems.value[currentVideoIndexZeroBased.value])

// Later pages load only when needed, so count them towards the progress.
const playlistVideoCount = computed(() => canLoadMorePlaylistVideos.value && Number.isFinite(playlistTotalVideoCount.value)
  ? Math.max(playlistItems.value.length, playlistTotalVideoCount.value)
  : playlistItems.value.length)

const playlistUnavailableVideoCount = computed(() => hasUnloadedPlaylistVideos.value
  ? 0
  : playlistTotalVideoCount.value - playlistItems.value.length)

const videoIndexInPlaylistItems = computed(() => {
  const items = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  return findIndexOfCurrentVideoInPlaylist(items)
})

const videoIsLastPlaylistItem = computed(() => {
  return videoIndexInPlaylistItems.value === (playlistItems.value.length - 1)
})

const videoIsNotPlaylistItem = computed(() => videoIndexInPlaylistItems.value === -1)

// Until the last page loads, the loaded videos are not the whole playlist.
const canLoadMorePlaylistVideos = computed(() => hasUnloadedPlaylistVideos.value && !playlistContinuationFailed.value)

// The current video may still be on an unloaded page, so do not fall back to
// the playlist start while later pages can still load.
const isWaitingForNextVideo = computed(() => canLoadMorePlaylistVideos.value &&
  (videoIsLastPlaylistItem.value || videoIsNotPlaylistItem.value))

// A page that is still loading or failed to load may hold the current video;
// wrapping to the first or last entry would jump away from its real neighbors.
const currentVideoMayBeUnloaded = computed(() => hasUnloadedPlaylistVideos.value && videoIsNotPlaylistItem.value)

// Sequential playback loads the next page while this many videos are still ahead.
const PLAYLIST_PRELOAD_DISTANCE = 50

const needsMorePlaylistVideos = computed(() => {
  if (!canLoadMorePlaylistVideos.value) return false
  // Reversed playback starts at the end and shuffle picks from the whole playlist.
  if (reversePlaylist.value || shuffleEnabled.value || playlistPanelNearEnd.value) return true
  if (playlistItems.value.length < requestedPlaylistVideoCount.value) return true
  const index = currentVideoIndexZeroBased.value
  // -1: the current video is on a later page. Loop steps back from the first video to the last.
  return index === -1 || index >= playlistItems.value.length - PLAYLIST_PRELOAD_DISTANCE ||
    (loopEnabled.value && index === 0)
})

const nextVideo = computed(() => {
  if (isWaitingForNextVideo.value || currentVideoMayBeUnloaded.value) return null
  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  const targetVideoIndex = (videoIsNotPlaylistItem.value || videoIsLastPlaylistItem.value)
    ? 0
    : videoIndexInPlaylistItems.value + 1

  return targetList[targetVideoIndex] ?? null
})

const upcomingVideos = computed(() => {
  // Entries before an unloaded current video are not upcoming, so do not preload them.
  if (currentVideoMayBeUnloaded.value) return []
  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value
  const currentIndex = findIndexOfCurrentVideoInPlaylist(targetList)
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1
  const remainingVideos = targetList.slice(startIndex)

  return loopEnabled.value && !canLoadMorePlaylistVideos.value && currentIndex !== -1
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

// Playlists without their own sort order follow the setting
const sortOrder = computed(() => {
  if (!isUserPlaylist.value) { return SORT_BY_VALUES.Custom }
  const playlistSortOrder = selectedUserPlaylist.value?.sortOrder
  return isPlaylistSortOrder(playlistSortOrder) ? playlistSortOrder : userPlaylistSortOrder.value
})

const isSortOrderCustom = computed(() => sortOrder.value === SORT_BY_VALUES.Custom)

const canMoveVideos = computed(() => {
  return isUserPlaylist.value && isSortOrderCustom.value && playlistItems.value.length > 1
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
  const index = playlistArrayIndex(previewVideoIndex.value - 1)

  if (index >= 0 && index < playlistItems.value.length) {
    return playlistItems.value[index].title || 'Unknown Title'
  }
  return ''
})

const previewVideoThumbnail = computed(() => {
  const index = playlistArrayIndex(previewVideoIndex.value - 1)

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

watch([() => props.playlistId, sortOrder], ([id], [oldId]) => {
  // Re-sort when the playlist page changes the sort order. Switching playlists loads them separately.
  if (id === oldId && selectedUserPlaylist.value != null) parseUserPlaylist(selectedUserPlaylist.value)
})

watch(() => props.videoId, (newId, oldId) => {
  // Check if next video is from the shuffled list or if the user clicked a different video
  // Automatic skips retain one order until playback succeeds or every entry has failed.
  if (shuffleEnabled.value && expectedAutoSkipItem !== (props.playlistItemId || newId)) {
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
  return item?.playlistItemId || item?.videoId || null
}

function resetUnavailableSkipChain() {
  skippedUnavailableItems.clear()
  expectedAutoSkipItem = null
}

watch([() => props.videoId, () => props.playlistItemId], () => {
  const currentKey = props.playlistItemId || props.videoId
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
  playlistLoadGeneration += 1
  isFetchingPlaylistContinuation.value = false
  setPlaylistPageLoader(null)
  playlistPanelNearEnd.value = false
  lastScrollPosition = null
  requestedPlaylistVideoCount.value = 0
  pendingProgressBarIndex = null
  progressBarTargetIndex.value = -1
  resetUnavailableSkipChain()
  reversePlaylist.value = storedReversePlaylist.value
  applyShuffleByDefault()

  // A reused watch view must also use the playlist cached by the page that opened it.
  const cachedPlaylist = store.getters.getCachedPlaylist(playlistCacheTabId)

  if (cachedPlaylist?.id === props.playlistId) {
    loadCachedPlaylistInformation(cachedPlaylist)
  } else if (selectedUserPlaylist.value != null) {
    parseUserPlaylist(selectedUserPlaylist.value)
    if (shuffleEnabled.value) shufflePlaylistItems()
  } else if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backendPreference.value)) {
    getPlaylistInformationInvidious()
  } else {
    getPlaylistInformationLocal()
  }
})

watch(needsMorePlaylistVideos, (needed) => {
  if (needed) continueLoadingPlaylistPages()
})

watch(storedReversePlaylist, (newVal) => {
  if (reversePlaylist.value !== newVal) {
    reversePlaylist.value = newVal
    playlistItems.value = playlistItems.value.toReversed()
  }
})

onMounted(() => {
  reversePlaylist.value = storedReversePlaylist.value

  const cachedPlaylist = store.getters.getCachedPlaylist(playlistCacheTabId)

  if (cachedPlaylist?.id === props.playlistId) {
    applyShuffleByDefault()
    loadCachedPlaylistInformation(cachedPlaylist)
  } else {
    getPlaylistInfoWithDelay()
  }
})

/**
 * @param {any[]} videoList
 * @param {any} [removedVideoStandIn] entry to match in place of the playing video once it was removed
 */
function findIndexOfCurrentVideoInPlaylist(videoList, removedVideoStandIn = prevVideoBeforeDeletion.value) {
  const playlistItemId = props.playlistItemId
  const videoId = props.videoId
  const prevVideoBeforeDeletionPlaylistItemId = removedVideoStandIn?.playlistItemId
  const prevVideoBeforeDeletionPlaylistVideoId = removedVideoStandIn?.videoId

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
    applyShuffleByDefault()
    parseUserPlaylist(selectedUserPlaylist.value)
    if (shuffleEnabled.value) shufflePlaylistItems()
  } else if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backendPreference.value)) {
    getPlaylistInformationInvidious()
  } else {
    getPlaylistInformationLocal()
  }
}

// Playlists set to shuffle by default start shuffled; the button still turns it off.
// Shuffle the user turned on stays on across playlists, but a playlist's default
// does not carry over to the next playlist.
let shuffleFromDefault = false

function applyShuffleByDefault() {
  if (selectedUserPlaylist.value?.shuffleByDefault === true) {
    if (!shuffleEnabled.value) {
      shuffleEnabled.value = true
      shuffleFromDefault = true
    }
  } else if (shuffleFromDefault) {
    shuffleEnabled.value = false
    shuffleFromDefault = false
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
  shuffleFromDefault = false
  if (shuffleEnabled.value) {
    shuffleEnabled.value = false
    showToast({ message: t('Shuffle is now disabled'), icon: ['fas', 'random'] })
  } else {
    shuffleEnabled.value = true
    showToast({ message: t('Shuffle is now enabled'), icon: ['fas', 'random'] })
    shufflePlaylistItems()
  }
}

function toggleReversePlaylist() {
  isLoading.value = true
  showToast({ message: t('The playlist has been reversed'), icon: ['fas', 'exchange-alt'] })

  reversePlaylist.value = !reversePlaylist.value
  persistReversePlaylistState()
  // Create a new array to avoid changing array in data store state
  // it could be user playlist or cache playlist
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
 * @param {(index: number, lastIndex: number) => number} getTargetIndex
 */
function moveVideo(videoId, playlistItemId, getTargetIndex) {
  const items = playlistItems.value.slice()
  const index = items.findIndex((video) => {
    return video.videoId === videoId && video.playlistItemId === playlistItemId
  })
  const targetIndex = getTargetIndex(index, items.length - 1)

  if (index === -1 || targetIndex === index || targetIndex < 0 || targetIndex >= items.length) { return }

  items.splice(targetIndex, 0, ...items.splice(index, 1))
  playlistItems.value = items
  persistPlaylistOrder(items)
}

function moveVideoUp(videoId, playlistItemId) {
  moveVideo(videoId, playlistItemId, index => index - 1)
}

function moveVideoDown(videoId, playlistItemId) {
  moveVideo(videoId, playlistItemId, index => index + 1)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
async function removeVideoFromPlaylist(videoId, playlistItemId) {
  try {
    await store.dispatch('removeVideo', {
      _id: props.playlistId,
      videoId,
      playlistItemId,
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

/**
 * @param {{ autoplay?: boolean }} [options] whether a restart of the current video should play it
 * @returns {string|null} the video ID it navigated to, or null when it did not navigate
 */
function playNextVideo({ autoplay = false } = {}) {
  if (isWaitingForNextVideo.value || currentVideoMayBeUnloaded.value) return null
  const videoIndex = videoIndexInPlaylistItems.value
  const targetVideoIndex = (videoIsNotPlaylistItem.value || videoIsLastPlaylistItem.value) ? 0 : videoIndex + 1

  const targetList = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  const targetPlaylistItem = targetList[targetVideoIndex]

  if (!targetPlaylistItem?.videoId) {
    return null
  }

  const downloadId = navigationDownloadId(store.getters, targetPlaylistItem.videoId, props.downloadId)
  const routerPushPayload = {
    path: `/watch/${targetPlaylistItem.videoId}`,
    query: {
      playlistId: props.playlistId,
      playlistType: props.playlistType,
      playlistItemId: targetPlaylistItem.playlistItemId,
      ...(downloadId ? { downloadId } : {})
    }
  }

  // Looping a single-item playlist can keep the current route, where a push loads
  // nothing. The watch view also ignores a change that only drops the timestamp.
  const withoutTimestamp = ({ path, query }) => router.resolve({ path, query: { ...query, timestamp: undefined } }).fullPath
  const staysOnRoute = withoutTimestamp(router.resolve(routerPushPayload)) === withoutTimestamp(router.currentRoute.value)
  const navigate = () => staysOnRoute ? emit('restart-current-video', autoplay) : router.push(routerPushPayload)

  if (shuffleEnabled.value) {
    let doShufflePlaylistItems = false

    if (videoIsLastPlaylistItem.value && !loopEnabled.value) {
      showToast({ message: t('The playlist has ended. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
      return null
    }
    // loopEnabled = true
    if (videoIsLastPlaylistItem.value || videoIsNotPlaylistItem.value) {
      doShufflePlaylistItems = true
    }

    navigate()

    showToast({ message: t('Playing Next Video'), icon: ['fas', 'step-forward'] })

    if (doShufflePlaylistItems && expectedAutoSkipItem === null) {
      shufflePlaylistItems()
    }
  } else {
    const stopDueToLoopDisabled = videoIsLastPlaylistItem.value && !loopEnabled.value

    if (stopDueToLoopDisabled) {
      showToast({ message: t('The playlist has ended. Enable loop to continue playing'), icon: ['fas', 'retweet'] })
      return null
    }

    navigate()
    showToast({ message: t('Playing Next Video'), icon: ['fas', 'step-forward'] })
  }
  return staysOnRoute ? null : targetPlaylistItem.videoId
}

function playPreviousVideo() {
  if (currentVideoMayBeUnloaded.value) return
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

  const downloadId = navigationDownloadId(store.getters, targetPlaylistItem.videoId, props.downloadId)
  router.push(
    {
      path: `/watch/${targetPlaylistItem.videoId}`,
      query: {
        playlistId: props.playlistId,
        playlistType: props.playlistType,
        playlistItemId: targetPlaylistItem.playlistItemId,
        ...(downloadId ? { downloadId } : {})
      }
    }
  )
}

/**
 * YouTube playlists follow the channels' members-only settings
 * @param {object[]} videos
 */
function filterVisiblePlaylistVideos(videos) {
  const membersOnlyChannelIds = store.getters.getMembersOnlyChannelIdSet
  return videos.filter(video => !isVideoHiddenByPreferences(video, { membersOnlyChannelIds }))
}

/** @param {object[]} items */
function parseVisibleLocalPlaylistVideos(items) {
  return filterVisiblePlaylistVideos(parseLocalPlaylistVideos(items))
}

/**
 * Adds the visible videos of the next page. The list grows in place, as copying
 * it for every page would take quadratic time on long playlists.
 * @param {object[]} newVideos
 */
function appendPlaylistVideos(newVideos) {
  if (newVideos.length === 0) return
  if (reversePlaylist.value) {
    playlistItems.value = newVideos.toReversed().concat(playlistItems.value)
  } else {
    playlistItems.value.push(...newVideos)
    triggerRef(playlistItems)
  }
  if (!shuffleEnabled.value) return
  const order = randomizedPlaylistItems.value
  const start = findIndexOfCurrentVideoInPlaylist(order) + 1
  if (start === 0) {
    // The current video may be on this page; restart the order from it.
    shufflePlaylistItems()
    return
  }
  // Keep entries up to the current video and mix new ones into the unplayed rest.
  for (const video of newVideos) {
    const target = start + Math.floor(Math.random() * (order.length - start + 1))
    order.push(order[target] ?? video)
    order[target] = video
  }
  triggerRef(randomizedPlaylistItems)
}

/** @type {{ generation: number, loadNextPage: () => Promise<{ videos: object[], hasMore: boolean }>, errorMessage: string } | null} */
let playlistPageLoader = null

/**
 * @param {(() => Promise<{ videos: object[], hasMore: boolean }>) | null} loadNextPage
 * @param {string} [errorMessage]
 */
function setPlaylistPageLoader(loadNextPage, errorMessage = '') {
  playlistPageLoader = loadNextPage && { generation: playlistLoadGeneration, loadNextPage, errorMessage }
  hasUnloadedPlaylistVideos.value = loadNextPage != null
  playlistContinuationFailed.value = false
}

// Requests later pages one at a time while `needsMorePlaylistVideos` holds.
async function continueLoadingPlaylistPages() {
  const loader = playlistPageLoader
  if (loader == null || loader.generation !== playlistLoadGeneration || isFetchingPlaylistContinuation.value) return

  isFetchingPlaylistContinuation.value = true
  try {
    while (needsMorePlaylistVideos.value) {
      const { videos, hasMore } = await loader.loadNextPage()
      if (loader.generation !== playlistLoadGeneration) return
      appendPlaylistVideos(videos)
      hasUnloadedPlaylistVideos.value = hasMore
      // Measure the panel with the new videos before deciding on another page.
      await nextTick()
      if (loader.generation !== playlistLoadGeneration) return
      updatePlaylistPanelNearEnd()
    }
  } catch (err) {
    // Keep the pages already shown instead of replacing them through the fallback.
    if (loader.generation !== playlistLoadGeneration) return
    playlistContinuationFailed.value = true
    console.error(err)
    showApiErrorToast(loader.errorMessage, err)
  } finally {
    if (loader.generation === playlistLoadGeneration) isFetchingPlaylistContinuation.value = false
  }
}

/**
 * @param {import('youtubei.js').YT.Playlist | null} playlist the last loaded page
 * @param {string} [cachedContinuation] the next page of a playlist the Playlist page loaded
 */
function localPlaylistPageLoader(playlist, cachedContinuation) {
  return async () => {
    playlist = playlist == null
      ? await getLocalCachedFeedContinuation('playlist', cachedContinuation)
      : await getLocalPlaylistContinuation(playlist)
    if (playlist == null) return { videos: [], hasMore: false }
    return { videos: parseVisibleLocalPlaylistVideos(playlist.items), hasMore: playlist.has_continuation }
  }
}

/**
 * Invidious pages overlap, so each later page adds only the videos not seen yet.
 * @param {string} playlistId
 * @param {object[]} loaded every video the instance returned so far
 * @param {{ videoCount: number, pageNumber: number }} position
 */
function invidiousPlaylistPageLoader(playlistId, loaded, { videoCount, pageNumber }) {
  return async () => {
    const page = await invidiousGetPlaylistInfo(playlistId, ++pageNumber)
    const merged = mergeInvidiousPlaylistVideos(loaded, page.videos)
    const videos = filterVisiblePlaylistVideos(merged.slice(loaded.length))
    loaded = merged
    return { videos, hasMore: hasMoreInvidiousPlaylistPages(videoCount, pageNumber, loaded.length, page.pageVideoCount) }
  }
}

/**
 * @param {{ id: string, title: string, channelName: string, channelId: string, items: VideoData[], continuationData: string | null, nextInvidiousPage?: number | null }} cachedPlaylist
 */
function loadCachedPlaylistInformation(cachedPlaylist) {
  getPlaylistInfoRun = true
  store.commit('setCachedPlaylist', { tabId: playlistCacheTabId, value: null })

  playlistTitle.value = cachedPlaylist.title
  playlistTotalVideoCount.value = cachedPlaylist.totalVideoCount
  channelName.value = cachedPlaylist.channelName
  channelId.value = cachedPlaylist.channelId

  const nextInvidiousPage = cachedPlaylist.nextInvidiousPage ?? null
  const videos = cachedPlaylist.items.slice()
  if (nextInvidiousPage !== null) {
    setPlaylistPageLoader(invidiousPlaylistPageLoader(cachedPlaylist.id, videos, {
      videoCount: cachedPlaylist.totalVideoCount, pageNumber: nextInvidiousPage - 1,
    }), getInvidiousApiErrorMessage(backendPreference.value))
  } else if (process.env.SUPPORTS_LOCAL_API && cachedPlaylist.continuationData !== null) {
    // The local API caches continuations, including when it was the fallback
    setPlaylistPageLoader(localPlaylistPageLoader(null, cachedPlaylist.continuationData), t('Local API Error (Click to copy)'))
  } else {
    setPlaylistPageLoader(null)
  }

  // Playback must not wait for later pages when the next video is already cached.
  // A sort preference can finish saving after the page cached its previous order.
  playlistItems.value = isUserPlaylist.value
    ? getSortedPlaylistItems(videos, sortOrder.value, locale.value, reversePlaylist.value)
    : applyReversePlaylistState(videos.slice())
  // Shuffle stays enabled across playlists, so rebuild the order from this one.
  if (shuffleEnabled.value) shufflePlaylistItems()
  isLoading.value = false

  return continueLoadingPlaylistPages()
}

async function getPlaylistInformationLocal() {
  const playlistId = props.playlistId
  const generation = playlistLoadGeneration
  isLoading.value = true

  try {
    const playlist = await getLocalPlaylist(playlistId)
    if (generation !== playlistLoadGeneration) return

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

    setPlaylistPageLoader(playlist.has_continuation ? localPlaylistPageLoader(playlist) : null, t('Local API Error (Click to copy)'))

    // Show the first page right away; later pages load as playback approaches them.
    playlistItems.value = applyReversePlaylistState(parseVisibleLocalPlaylistVideos(playlist.items))
    if (shuffleEnabled.value) shufflePlaylistItems()
    isLoading.value = false
  } catch (err) {
    if (generation !== playlistLoadGeneration) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      getPlaylistInformationInvidious()
    } else {
      isLoading.value = false
    }
    return
  }

  return continueLoadingPlaylistPages()
}

async function getPlaylistInformationInvidious() {
  const playlistId = props.playlistId
  const generation = playlistLoadGeneration
  isLoading.value = true

  try {
    const result = await invidiousGetPlaylistInfo(playlistId)
    if (generation !== playlistLoadGeneration) return

    playlistTitle.value = result.title
    playlistTotalVideoCount.value = result.videoCount
    channelName.value = result.author
    channelId.value = result.authorId

    const position = { videoCount: result.videoCount, pageNumber: 1 }
    setPlaylistPageLoader(
      hasMoreInvidiousPlaylistPages(position.videoCount, position.pageNumber, result.videos.length, result.pageVideoCount)
        ? invidiousPlaylistPageLoader(playlistId, result.videos, position)
        : null,
      getInvidiousApiErrorMessage(backendPreference.value)
    )

    // Show the first page right away; later pages load as playback approaches them.
    playlistItems.value = applyReversePlaylistState(filterVisiblePlaylistVideos(result.videos))
    if (shuffleEnabled.value) shufflePlaylistItems()
    isLoading.value = false
  } catch (err) {
    if (generation !== playlistLoadGeneration) return
    console.error(err)
    const errorMessage = getInvidiousApiErrorMessage(backendPreference.value)
    showApiErrorToast(errorMessage, err)
    if (process.env.SUPPORTS_LOCAL_API && usesInvidiousApi(backendPreference.value) && backendFallback.value) {
      showInvidiousFallbackToast(backendPreference.value)
      getPlaylistInformationLocal()
    } else {
      isLoading.value = false
    }
    return
  }

  return continueLoadingPlaylistPages()
}

function parseUserPlaylist(playlist) {
  playlistTitle.value = playlist.playlistName
  // A YouTube playlist shown before must not count this one's videos as unavailable
  playlistTotalVideoCount.value = playlist.videos.length
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
let playlistItemsScrollListener = null

function stopObservingPlaylistItems() {
  playlistItemsObserver?.disconnect()
  playlistItemsObserver = null
  playlistItemsScrollListener?.abort()
  playlistItemsScrollListener = null
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

  let wasScrollContainer = getComputedStyle(container).overflowY !== 'visible'
  const scheduleClamp = () => {
    playlistItemsClampFrame ??= requestAnimationFrame(() => {
      playlistItemsClampFrame = null
      // The browser keeps the raw offset while a stacked fullscreen panel makes the
      // whole dock scroll, but rows above can be remeasured meanwhile.
      const scrollContainer = getComputedStyle(container).overflowY !== 'visible'
      if (scrollContainer && !wasScrollContainer && lastScrollPosition != null) {
        applyScrollPosition(container, lastScrollPosition)
      }
      wasScrollContainer = scrollContainer
      const items = container.querySelectorAll(':scope > .playlistItem')
      clampOverlayScrollTop(
        container,
        items[items.length - 1] ?? null
      )
      if (needsInitialCenter.value && container.clientHeight > 0) {
        centerCurrentVideo()
      }
      updatePlaylistPanelNearEnd()
    })
  }
  playlistItemsScrollListener = new AbortController()
  container.addEventListener('scroll', updatePlaylistPanelNearEnd, { passive: true, signal: playlistItemsScrollListener.signal })
  container.addEventListener('scroll', rememberScrollPosition, { passive: true, signal: playlistItemsScrollListener.signal })
  // Windowed rows shrink to measured shells after layout changes without any
  // child list mutation, so watch each row's size as well as the viewport.
  const resizeObserver = playlistItemsResizeObserver = new ResizeObserver(scheduleClamp)
  resizeObserver.observe(container)
  for (const item of container.querySelectorAll(':scope > .playlistItem')) resizeObserver.observe(item)
  playlistItemsObserver = new MutationObserver(records => {
    for (const { addedNodes, removedNodes } of records) {
      for (const node of removedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) resizeObserver.unobserve(node)
      }
      for (const node of addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('playlistItem')) resizeObserver.observe(node)
      }
    }
    scheduleClamp()
  })
  playlistItemsObserver.observe(container, { childList: true })
}, { flush: 'post' })

onBeforeUnmount(stopObservingPlaylistItems)

// Load later pages before the end of the panel scrolls into view.
function updatePlaylistPanelNearEnd() {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
  playlistPanelNearEnd.value = canLoadMorePlaylistVideos.value && container != null && container.clientHeight > 0 &&
    container.scrollHeight - container.scrollTop - container.clientHeight < container.clientHeight * 2
}

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

// Distant rows keep the heights they had in the previous layout until they are
// remeasured, so the same offset would show other rows after moving between the
// sidebar and the fullscreen dock. Keep the first visible row in place instead.
// Leaving fullscreen restyles the dock before it closes, so remember the row
// whenever the list scrolls rather than measuring it then.
/** @type {{ index: number, offset: number } | null} */
let lastScrollPosition = null

function rememberScrollPosition() {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
  // A stacked fullscreen panel can make the whole dock scroll instead of the list.
  if (container != null && getComputedStyle(container).overflowY !== 'visible') {
    lastScrollPosition = measureScrollPosition()
  }
}

function getScrollPosition() {
  return lastScrollPosition ?? measureScrollPosition()
}

function measureScrollPosition() {
  const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
  const rows = container?.querySelectorAll(':scope > .playlistItem') ?? []
  if (rows.length === 0) return null
  // Layout offsets ignore the transforms of rows that are moving into place.
  // Overlay scrollbars keep the list positioned, so it is the rows' offset parent.
  const scrollTop = container.scrollTop
  let low = 0
  let high = rows.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (rows[middle].offsetTop + rows[middle].offsetHeight > scrollTop) high = middle
    else low = middle + 1
  }
  return { index: low, offset: rows[low].offsetTop - scrollTop }
}

/** @param {{ index: number, offset: number }} position */
function restoreScrollPosition(position) {
  nextTick(() => {
    requestAnimationFrame(() => {
      const container = playlistItemsWrapper.value?.$el ?? playlistItemsWrapper.value
      if (container != null) applyScrollPosition(container, position)
    })
  })
}

/**
 * @param {HTMLElement} container
 * @param {{ index: number, offset: number }} position
 */
function applyScrollPosition(container, { index, offset }) {
  const row = container.querySelectorAll(':scope > .playlistItem')[index]
  if (row != null) restoreOverlayScrollTop(container, row.offsetTop - offset)
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
function handleProgressBarClick(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const progressBarWidth = rect.width
  const clickPercentage = clickX / progressBarWidth

  const targetVideoIndex = Math.max(1, Math.min(playlistVideoCount.value, Math.ceil(clickPercentage * playlistVideoCount.value)))
  const targetArrayIndex = playlistArrayIndex(targetVideoIndex - 1)

  if (targetArrayIndex >= 0 && targetArrayIndex < playlistItems.value.length) {
    pendingProgressBarIndex = null
    // Stop loading towards an unloaded video chosen before.
    requestedPlaylistVideoCount.value = 0
    scrollToProgressBarTarget(targetArrayIndex)
  } else {
    // Load the pages up to the chosen video, then show it.
    pendingProgressBarIndex = targetVideoIndex - 1
    requestedPlaylistVideoCount.value = targetVideoIndex
  }
}

/**
 * The index in the loaded videos of a position in the whole playlist. Reversed
 * playlists add later pages at the start, so their loaded videos fill its end.
 * @param {number} position
 */
function playlistArrayIndex(position) {
  return reversePlaylist.value ? position - (playlistVideoCount.value - playlistItems.value.length) : position
}

watch([() => playlistItems.value.length, canLoadMorePlaylistVideos], ([length, canLoadMore]) => {
  if (pendingProgressBarIndex === null) return
  const arrayIndex = playlistArrayIndex(pendingProgressBarIndex)
  if ((arrayIndex < 0 || arrayIndex >= length) && canLoadMore) return
  // Hidden or unavailable videos can leave the playlist shorter than its total.
  const index = Math.max(0, Math.min(arrayIndex, length - 1))
  pendingProgressBarIndex = null
  scrollToProgressBarTarget(index)
}, { flush: 'post' })

/** @param {number} index */
function scrollToProgressBarTarget(index) {
  progressBarTargetIndex.value = index
  nextTick(() => {
    requestAnimationFrame(() => {
      scrollToVideo(index)
      requestAnimationFrame(() => scrollToVideo(index))
    })
  })
}

const videoIsLastInInPlaylistItems = computed(() => {
  if (shuffleEnabled.value) {
    return videoIndexInPlaylistItems.value === randomizedPlaylistItems.value.length - 1
  } else {
    return videoIndexInPlaylistItems.value === playlistItems.value.length - 1
  }
})

const shouldStopDueToPlaylistEnd = computed(() => {
  // Loop enabled = should not stop
  return videoIsLastInInPlaylistItems.value && !loopEnabled.value && !canLoadMorePlaylistVideos.value
})

/**
 * Index that `playPreviousVideo` steps back from.
 *
 * When the current video being watched in the playlist is deleted,
 * the previous video stands in for the "current" one.
 * So if we want to play the previous video, in this case,
 * we actually want to play that stand-in video.
 * The only exception is when shuffle is enabled, as we don't actually
 * want to play the last sequential video with shuffle.
 */
const previousVideoSourceIndex = computed(() => {
  const videoIndex = videoIndexInPlaylistItems.value

  return prevVideoBeforeDeletion.value && !shuffleEnabled.value ? videoIndex + 1 : videoIndex
})

const skipAvailability = computed(() => {
  if (currentVideoMayBeUnloaded.value) return { canPlayNext: false, canPlayPrevious: false }
  const items = shuffleEnabled.value ? randomizedPlaylistItems.value : playlistItems.value

  return getPlaylistSkipAvailability({
    itemCount: items.length,
    currentIndex: videoIndexInPlaylistItems.value,
    loopEnabled: loopEnabled.value && !canLoadMorePlaylistVideos.value,
    previousVideoSourceIndex: previousVideoSourceIndex.value
  })
})

const canPlayNextVideo = computed(() => skipAvailability.value.canPlayNext)

const canPlayPreviousVideo = computed(() => skipAvailability.value.canPlayPrevious)

watch(
  [() => props.autoSkipUnavailable, isLoading, () => props.watchViewLoading, nextVideo, canPlayNextVideo],
  ([shouldSkip, playlistLoading, watchViewLoading, nextItem, canPlayNext]) => {
    if (!shouldSkip || playlistLoading || watchViewLoading || !canPlayNext) return

    const currentKey = props.playlistItemId || props.videoId
    const nextKey = playlistItemKey(nextItem)
    if (!nextKey || nextKey === currentKey || skippedUnavailableItems.has(currentKey) ||
      skippedUnavailableItems.has(nextKey)) return

    skippedUnavailableItems.add(currentKey)
    expectedAutoSkipItem = nextKey
    const nextVideoId = playNextVideo()
    if (nextVideoId) emit('unavailable-video-skipped', nextVideoId)
  },
  { flush: 'post' }
)

// The watch view owns the skip actions, as it also knows about the watch queue
watch([canPlayNextVideo, canPlayPreviousVideo], ([canPlayNext, canPlayPrevious]) => {
  emit('skip-availability-change', { canPlayNext, canPlayPrevious })
}, { immediate: true })

defineExpose({
  centerCurrentVideo,
  getScrollPosition,
  restoreScrollPosition,
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
      ? playlistItems.value.length - currentVideoIndexOneBased.value
      : currentVideoIndexZeroBased.value,
    reverse: reversePlaylist.value,
    shuffle: shuffleEnabled.value,
    loop: loopEnabled.value
  })
})
</script>

<style scoped src="./WatchVideoPlaylist.css" />
