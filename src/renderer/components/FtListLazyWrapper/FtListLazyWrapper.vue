<template>
  <div
    v-if="showResult"
    v-observe-visibility="visible ? false : {
      callback: onVisibilityChanged
    }"
    :class="{
      grid: layout === 'grid',
      list: layout === 'list',
      draggable: isDraggable,
      draggedVideo: isVideoDragging && draggedVideo.videoId === data.videoId && draggedVideo.playlistItemId === data.playlistItemId,
    }"
    :draggable="isDraggable"
    v-on="isDraggable ? draggableEventHandlers : {}"
  >
    <template
      v-if="visible"
    >
      <FtListVideo
        v-if="finalDataType === 'video' || finalDataType === 'shortVideo'"
        :appearance="appearance"
        :data="data"
        :playlist-id="playlistId"
        :playlist-type="playlistType"
        :playlist-item-id="playlistItemId"
        :show-video-with-last-viewed-playlist="showVideoWithLastViewedPlaylist"
        :show-watched-style-in-history="showWatchedStyleInHistory"
        :always-show-add-to-playlist-button="alwaysShowAddToPlaylistButton"
        :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
        :can-move-video-up="canMoveVideoUp"
        :can-move-video-down="canMoveVideoDown"
        :can-remove-from-playlist="canRemoveFromPlaylist"
        :layout="layout"
        :show-grab-bar="isDraggable && layout === 'grid'"
        @move-video-up="moveVideoUp"
        @move-video-down="moveVideoDown"
        @move-video-to-the-top="moveVideoToTheTop"
        @move-video-to-the-bottom="moveVideoToTheBottom"
        @remove-from-playlist="removeFromPlaylist"
      />
      <FtListChannel
        v-else-if="finalDataType === 'channel'"
        :appearance="appearance"
        :data="data"
      />
      <FtListPlaylist
        v-else-if="finalDataType === 'playlist'"
        :appearance="appearance"
        :data="data"
        :search-query-text="searchQueryText"
      />
      <FtCommunityPost
        v-else-if="finalDataType === 'community'"
        :hide-forbidden-titles="hideForbiddenTitles"
        :appearance="appearance"
        :data="data"
      />
      <FtListHashtag
        v-else-if="data.type === 'hashtag'"
        :appearance="appearance"
        :data="data"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

import { handleDragAndDrop } from '../../helpers/dragAndDrop'

import FtListVideo from '../FtListVideo/FtListVideo.vue'
import FtListChannel from '../FtListChannel/FtListChannel.vue'
import FtListPlaylist from '../FtListPlaylist/FtListPlaylist.vue'
import FtCommunityPost from '../FtCommunityPost/FtCommunityPost.vue'
import FtListHashtag from '../FtListHashtag/FtListHashtag.vue'

import store from '../../store/index'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'

const props = defineProps({
  data: {
    type: Object,
    required: true
  },
  dataType: {
    type: String,
    default: null,
  },
  appearance: {
    type: String,
    required: true
  },
  firstScreen: {
    type: Boolean,
    required: true
  },
  layout: {
    type: String,
    default: 'grid'
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
  playlistId: {
    type: String,
    default: null
  },
  playlistType: {
    type: String,
    default: null
  },
  playlistItemId: {
    type: String,
    default: null
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

const inUserPlaylist = props.playlistType === 'user'
const isDraggable = computed(() => inUserPlaylist && props.isSortOrderCustom && (props.canMoveVideoUp || props.canMoveVideoDown))
const { dragVideo, moveDraggedVideo, afterDrag } = handleDragAndDrop(emit)
const draggableEventHandlers = {
  dragstart: onDragVideo,
  dragover: event => event.preventDefault(),
  dragenter: () => {
    if (props.isVideoDragging) {
      moveDraggedVideo(videoData, props.draggedVideo)
    }
  },
  dragend: afterDrag,
  drop: event => event.preventDefault(),
}

/** @type {import('vue').ComputedRef<'video' | 'shortVideo' | 'channel' | 'playlist' | 'community'>} */
const finalDataType = computed(() => {
  return props.data.type ?? props.dataType
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideLiveStreams = computed(() => {
  return store.getters.getHideLiveStreams
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideUpcomingPremieres = computed(() => {
  if (!props.useHideUpcomingPremieresPreference) { return false }

  return store.getters.getHideUpcomingPremieres
})

const EMPTY_SET = new Set()

/** @type {import('vue').ComputedRef<Set<string>>} */
const channelsHiddenNames = computed(() => {
  // Some component users like channel view will have this disabled
  if (!props.useChannelsHiddenPreference) { return EMPTY_SET }

  return store.getters.getChannelsHiddenNames
})

/** @type {import('vue').ComputedRef<string[]>} */
const forbiddenTitles = computed(() => {
  if (!props.hideForbiddenTitles) { return [] }
  return store.getters.getForbiddenTitlesParsed
})

const showResult = computed(() => {
  const dataType = finalDataType.value

  if (!dataType) {
    return false
  }

  if (dataType === 'video' || dataType === 'shortVideo') {
    if (isVideoHiddenByPreferences(props.data, {
      hideLiveStreams: hideLiveStreams.value,
      hideUpcomingPremieres: hideUpcomingPremieres.value,
      hiddenChannelNames: channelsHiddenNames.value,
      forbiddenTitles: forbiddenTitles.value
    })) {
      return false
    }
  } else if (dataType === 'channel') {
    const attrsToCheck = [
      // Local API
      props.data.id,
      props.data.name,
      // Invidious API
      // https://docs.invidious.io/api/common_types/#channelobject
      props.data.author,
      props.data.authorId,
    ]

    const lowerCaseName = props.data.name?.toLowerCase()

    if ((attrsToCheck.some(a => a != null && channelsHiddenNames.value.has(a))) ||
      (forbiddenTitles.value.some((text) => lowerCaseName.includes(text)))) {
      // hide channels by author
      return false
    }
  } else if (dataType === 'playlist') {
    const lowerCaseTitle = props.data.title?.toLowerCase()
    const lowerCaseChannelName = props.data.channelName?.toLowerCase()

    if ((forbiddenTitles.value.some((text) => lowerCaseTitle.includes(text))) ||
      (forbiddenTitles.value.some((text) => lowerCaseChannelName.includes(text)))) {
      return false
    }

    const attrsToCheck = [
      // Local API
      props.data.channelId,
      props.data.channelName,
      // Invidious API
      // https://docs.invidious.io/api/common_types/#playlistobject
      props.data.author,
      props.data.authorId,
    ]

    if (attrsToCheck.some(a => a != null && channelsHiddenNames.value.has(a))) {
      // hide playlists by author
      return false
    }
  }
  return true
})

const visible = ref(props.firstScreen)

/**
 * @param {boolean} isVisible
 */
function onVisibilityChanged(isVisible) {
  if (isVisible) {
    visible.value = isVisible
  }
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
function moveVideoToTheTop(videoId, playlistItemId) {
  emit('move-video-to-the-top', videoId, playlistItemId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function moveVideoToTheBottom(videoId, playlistItemId) {
  emit('move-video-to-the-bottom', videoId, playlistItemId)
}

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function removeFromPlaylist(videoId, playlistItemId) {
  emit('remove-from-playlist', videoId, playlistItemId)
}

function onDragVideo(event) {
  // Only allow dragging via the drag bar
  if (!event.target.classList.contains('draggable')) { return }

  dragVideo(event, videoData)
}

/** @import { VideoData } from '../../helpers/dragAndDrop' */

/** @type {VideoData} */
const videoData = {
  videoId: props.data.videoId,
  playlistItemId: props.playlistItemId,
}

</script>

<style scoped src="./FtListLazyWrapper.css" />
