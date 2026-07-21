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
      @pause-player="pausePlayer"
      @move-video-up="moveVideoUp"
      @move-video-down="moveVideoDown"
      @remove-from-playlist="removeFromPlaylist"
    />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

import FtListVideo from './FtListVideo/FtListVideo.vue'

import store from '../store/index'

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

const visible = ref(props.initialVisibleState)
const display = ref('block')

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

const hideChannelsBasedOnText = computed(() => {
  return store.getters.getHideChannelsBasedOnText
})

const shouldBeVisible = computed(() => {
  const lowerCaseTitle = props.data.title?.toLowerCase()
  const lowerCaseAuthor = props.data.author?.toLowerCase()

  return !(channelsHiddenNames.value.has(props.data.authorId) ||
    channelsHiddenNames.value.has(props.data.author) ||
    (lowerCaseTitle && forbiddenTitles.value.some((text) => lowerCaseTitle.includes(text))) ||
    (hideChannelsBasedOnText.value && lowerCaseAuthor && forbiddenTitles.value.some((text) => lowerCaseAuthor.includes(text))))
})

/**
 * @param {boolean} isVisible
 */
function onVisibilityChanged(isVisible) {
  if (isVisible && shouldBeVisible.value) {
    visible.value = isVisible
  } else if (isVisible) {
    display.value = 'none'
  }
}

const emit = defineEmits(['pause-player', 'move-video-up', 'move-video-down', 'remove-from-playlist'])

function pausePlayer() {
  emit('pause-player')
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
