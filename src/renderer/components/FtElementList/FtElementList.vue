<template>
  <FtAutoGrid
    :grid="displayValue !== 'list'"
    :thumbnail-size="thumbnailSize"
  >
    <FtListLazyWrapper
      v-for="(result, index) in data"
      :key="getResultKey(result, index)"
      appearance="result"
      :data="result"
      :data-type="dataType || result.type"
      :first-screen="!renderAllItemsLazily && index < 16"
      :layout="displayValue"
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
      :is-sort-order-custom="isSortOrderCustom"
      :is-video-dragging="isVideoDragging"
      @drag-video="dragVideo"
      @move-dragged-video="moveDraggedVideo"
      @drag-video-end="afterDrag"
      @move-video-up="moveVideoUp"
      @move-video-down="moveVideoDown"
      @remove-from-playlist="removeFromPlaylist"
    />
  </FtAutoGrid>
</template>

<script setup>
import { computed } from 'vue'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'
import FtListLazyWrapper from '../FtListLazyWrapper/FtListLazyWrapper.vue'

import store from '../../store/index'

const props = defineProps({
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
  isSortOrderCustom: {
    type: Boolean,
    default: false,
  },
  isVideoDragging: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['move-dragged-video', 'move-video-down', 'move-video-up', 'remove-from-playlist', 'drag-video', 'drag-video-end'])

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => {
  return store.getters.getListType
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const displayValue = computed(() => {
  return props.display === '' ? listType.value : props.display
})

/** @type {import('vue').ComputedRef<number>} */
const thumbnailSize = computed(() => store.getters.getThumbnailSize)

function getResultKey(result, index) {
  const type = props.dataType || result.type
  const id = result.videoId || result.playlistId || result.postId || result.id || result._id || result.authorId || result.title
  const occurrence = props.stableItemKeys ? '' : result.playlistItemId || index

  return `${type}-${id}-${occurrence}-${result.lastUpdatedAt || 0}`
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoUp(videoId, playlistItemId) {
  emit('move-video-up', videoId, playlistItemId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoDown(videoId, playlistItemId) {
  emit('move-video-down', videoId, playlistItemId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function removeFromPlaylist(videoId, playlistItemId) {
  emit('remove-from-playlist', videoId, playlistItemId)
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
