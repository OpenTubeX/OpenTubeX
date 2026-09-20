<template>
  <div
    v-observe-visibility="visible ? false : {
      callback: onVisibilityChanged
    }"
    :style="{ display }"
  >
    <FtListVideo
      v-if="visible"
      :data="data"
      :playlist-id="playlistId"
      :playlist-type="playlistType"
      :playlist-index="playlistIndex"
      :playlist-reverse="playlistReverse"
      :playlist-shuffle="playlistShuffle"
      :playlist-loop="playlistLoop"
      :playlist-item-id="playlistItemId"
      :force-list-type="forceListType"
      :appearance="appearance"
      :always-show-add-to-playlist-button="alwaysShowAddToPlaylistButton"
      :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
      :can-move-video-up="canMoveVideoUp"
      :can-move-video-down="canMoveVideoDown"
      :can-remove-from-playlist="canRemoveFromPlaylist"
      @move-video-to-the-top="moveVideoToTheTop"
      @move-video-to-the-bottom="moveVideoToTheBottom"
      @pause-player="pausePlayer"
      @move-video-up="moveVideoUp"
      @move-video-down="moveVideoDown"
      @remove-from-playlist="removeFromPlaylist"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import FtListVideo from './FtListVideo/FtListVideo.vue'

import store from '../store/index'
import { isVideoHiddenByPreferences } from '../helpers/subscriptions'

const props = defineProps({
  data: {
    type: Object,
    required: true
  },
  playlistId: {
    type: String,
    default: null
  },
  playlistType: {
    type: String,
    default: null
  },
  playlistIndex: {
    type: Number,
    default: null
  },
  playlistReverse: {
    type: Boolean,
    default: false
  },
  playlistShuffle: {
    type: Boolean,
    default: false
  },
  playlistLoop: {
    type: Boolean,
    default: false
  },
  playlistItemId: {
    type: String,
    default: null,
  },
  forceListType: {
    type: String,
    default: null
  },
  appearance: {
    type: String,
    required: true
  },
  initialVisibleState: {
    type: Boolean,
    default: false,
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
  useChannelsHiddenPreference: {
    type: Boolean,
    default: false,
  },
  hideForbiddenTitles: {
    type: Boolean,
    default: true
  }
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

const shouldBeVisible = computed(() => {
  return !isVideoHiddenByPreferences(props.data, {
    hiddenChannelNames: channelsHiddenNames.value,
    forbiddenTitles: forbiddenTitles.value,
    hideChannelsBasedOnText: false,
  })
})

const visible = ref(props.initialVisibleState && shouldBeVisible.value)
const display = ref(shouldBeVisible.value ? 'block' : 'none')
const loadedByVisibilityObserver = ref(false)

watch(() => props.initialVisibleState, (initialVisibleState) => {
  if (!shouldBeVisible.value) {
    visible.value = false
    display.value = 'none'
  } else if (initialVisibleState) {
    visible.value = true
    display.value = 'block'
  } else if (!loadedByVisibilityObserver.value) {
    visible.value = false
  }
})

/**
 * @param {boolean} isVisible
 */
function onVisibilityChanged(isVisible) {
  if (isVisible && shouldBeVisible.value) {
    loadedByVisibilityObserver.value = true
    visible.value = isVisible
  } else if (isVisible) {
    display.value = 'none'
  }
}

const emit = defineEmits([
  'pause-player',
  'move-video-up',
  'move-video-down',
  'move-video-to-the-top',
  'move-video-to-the-bottom',
  'remove-from-playlist'
])

function pausePlayer() {
  emit('pause-player')
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
</script>
