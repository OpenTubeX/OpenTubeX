<template>
  <FtAutoGrid
    :appear="appear"
    :grid="effectiveDisplayValue !== 'list'"
    :item-count="data.length"
    :item-keys="resultKeys"
    :youtube-style-shorts="youtubeStyleShorts"
  >
    <FtListLazyWrapper
      v-for="(result, index) in data"
      :key="resultKeys[index]"
      :data-feed-item-key="resultKeys[index]"
      :appearance="youtubeStyleShorts ? 'youtubeShort' : 'result'"
      :data="reactive(result)"
      :data-overrides="dataOverrides"
      :data-type="dataType || result.type"
      :first-screen="!renderAllItemsLazily && index < 16"
      :layout="effectiveDisplayValue"
      :show-video-with-last-viewed-playlist="showVideoWithLastViewedPlaylist"
      :show-watched-style-in-history="showWatchedStyleInHistory"
      :use-channels-hidden-preference="useChannelsHiddenPreference"
      :use-hide-upcoming-premieres-preference="useHideUpcomingPremieresPreference"
      :hide-forbidden-titles="hideForbiddenTitles"
      :always-show-add-to-playlist-button="alwaysShowAddToPlaylistButton"
      :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
      :can-move-video-up="canMoveVideoUp && index > 0"
      :can-move-video-down="canMoveVideoDown && index < playlistItemsLength - 1"
      :can-remove-from-playlist="canRemoveFromPlaylist"
      :search-query-text="searchQueryText"
      :playlist-id="playlistId"
      :playlist-type="playlistType"
      :playlist-item-id="result.playlistItemId"
      :dragged-video="draggedVideo"
      :is-video-dragging="isVideoDragging"
      :video-dragging-possible="videoDraggingPossible"
      @drag-video="dragVideo"
      @move-dragged-video="moveDraggedVideo"
      @drag-video-end="afterDrag"
      @move-video-up="moveVideoUp"
      @move-video-down="moveVideoDown"
      @move-video-to-the-top="moveVideoToTheTop"
      @move-video-to-the-bottom="moveVideoToTheBottom"
      @remove-from-playlist="removeFromPlaylist"
    />
  </FtAutoGrid>
</template>

<script setup>
import { computed, provide, reactive } from 'vue'
import { subscriptionFeedTypeKey } from '../../composables/useHideSubscriptionFeedType'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'
import FtListLazyWrapper from '../FtListLazyWrapper/FtListLazyWrapper.vue'

import store from '../../store/index'

const props = defineProps({
  dataOverrides: {
    type: Object,
    default: null
  },
  subscriptionFeedType: {
    type: String,
    default: null
  },
  appear: {
    type: Boolean,
    default: false
  },
  data: {
    type: Array,
    required: true
  },
  dataType: {
    type: String,
    default: null,
  },
  stableItemKeys: {
    type: Boolean,
    default: false
  },
  renderAllItemsLazily: {
    type: Boolean,
    default: false
  },
  display: {
    type: String,
    required: false,
    default: ''
  },
  showVideoWithLastViewedPlaylist: {
    type: Boolean,
    default: false
  },
  showWatchedStyleInHistory: {
    type: Boolean,
    default: false,
  },
  useChannelsHiddenPreference: {
    type: Boolean,
    default: true,
  },
  useHideUpcomingPremieresPreference: {
    type: Boolean,
    default: true,
  },
  hideForbiddenTitles: {
    type: Boolean,
    default: true
  },
  searchQueryText: {
    type: String,
    required: false,
    default: '',
  },
  alwaysShowAddToPlaylistButton: {
    type: Boolean,
    default: false,
  },
  quickBookmarkButtonEnabled: {
    type: Boolean,
    default: true,
  },
  canMoveVideoUp: {
    type: Boolean,
    default: false,
  },
  canMoveVideoDown: {
    type: Boolean,
    default: false,
  },
  canRemoveFromPlaylist: {
    type: Boolean,
    default: false,
  },
  playlistItemsLength: {
    type: Number,
    default: 0
  },
  playlistId: {
    type: String,
    default: null
  },
  playlistType: {
    type: String,
    default: null
  },
  draggedVideo: {
    type: Object,
    default: () => ({ videoId: null, playlistItemId: null }),
  },
  isVideoDragging: {
    type: Boolean,
    default: false,
  },
  videoDraggingPossible: {
    type: Boolean,
    default: false,
  },
  youtubeStyleShorts: {
    type: Boolean,
    default: false,
  },
})

provide(subscriptionFeedTypeKey, computed(() => props.subscriptionFeedType))

const emit = defineEmits([
  'move-dragged-video',
  'move-video-down',
  'move-video-up',
  'move-video-to-the-top',
  'move-video-to-the-bottom',
  'remove-from-playlist',
  'drag-video',
  'drag-video-end'
])

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => {
  return store.getters.getListType
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const displayValue = computed(() => {
  return props.display === '' ? listType.value : props.display
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const effectiveDisplayValue = computed(() => {
  return props.youtubeStyleShorts ? 'grid' : displayValue.value
})

function getResultKey(result, index) {
  const type = props.dataType || result.type
  const id = result.videoId || result.playlistId || result.postId || result.id || result._id || result.authorId || result.title
  const occurrence = result._libraryMemberId || (props.stableItemKeys ? result._id || '' : result.playlistItemId || index)

  return `${type}-${id}-${occurrence}-${result.lastUpdatedAt || 0}`
}

const resultKeys = computed(() => props.data.map(getResultKey))

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoUp(videoId, playlistItemId, memberId) {
  emit('move-video-up', videoId, playlistItemId, memberId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoDown(videoId, playlistItemId, memberId) {
  emit('move-video-down', videoId, playlistItemId, memberId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoToTheTop(videoId, playlistItemId, memberId) {
  emit('move-video-to-the-top', videoId, playlistItemId, memberId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoToTheBottom(videoId, playlistItemId, memberId) {
  emit('move-video-to-the-bottom', videoId, playlistItemId, memberId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function removeFromPlaylist(videoId, playlistItemId, memberId) {
  emit('remove-from-playlist', videoId, playlistItemId, memberId)
}

/** @import { VideoData } from '../../helpers/dragAndDrop' */

/**
 * @param {VideoData} video
 */
function dragVideo(video) {
  emit('drag-video', video)
}

/**
 * @param {VideoData} video
 * @param {VideoData} draggedVideo
 */
function moveDraggedVideo(video, draggedVideo) {
  emit('move-dragged-video', video, draggedVideo)
}

function afterDrag() {
  emit('drag-video-end')
}

</script>

<style scoped src="./FtElementList.css" />
