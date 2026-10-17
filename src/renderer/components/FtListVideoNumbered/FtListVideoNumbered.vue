<template>
  <div
    ref="row"
    v-first-visible="windowed || visible ? false : onFirstVisible"
    :style="!visible && shellHeight ? { blockSize: `${shellHeight}px` } : undefined"
    :class="{
      placeholder: !visible,
      draggable: canBecomeDraggable,
      pointerDragging,
      draggedVideo: isVideoDragging && draggedVideo.videoId === data.videoId && draggedVideo.playlistItemId === data.playlistItemId,
    }"
    :draggable="canBecomeDraggable && !pointerDragging"
    :data-playlist-drag-item="canBecomeDraggable ? '' : null"
    :data-video-id="data.videoId"
    :data-playlist-item-id="playlistItemId"
    @pointerdown.capture="canBecomeDraggable && startPointerDrag($event, videoData)"
    @keydown="canBecomeDraggable && moveWithKeyboard($event, videoData)"
    v-on="canBecomeDraggable ? draggableEventHandlers : {}"
  >
    <template
      v-if="visible"
    >
      <p
        class="videoIndexArea"
        :role="canBecomeDraggable ? 'button' : null"
        :tabindex="canBecomeDraggable ? 0 : null"
        :aria-label="canBecomeDraggable ? t('User Playlists.Reorder Hint') : null"
        :title="canBecomeDraggable ? t('User Playlists.Reorder Hint') : null"
        :aria-keyshortcuts="canBecomeDraggable ? 'ArrowUp ArrowDown Home End' : null"
      >
        <FtIcon
          v-if="isCurrentVideo"
          class="videoIndexIcon"
          :icon="['fas', 'play']"
        />

        <template
          v-else
        >
          <FtIcon
            v-if="canBecomeDraggable"
            class="grabBar"
            :icon="['fas', 'bars']"
          />

          <span
            class="videoIndex"
          >
            {{ videoIndex + 1 }}
          </span>
        </template>
        <FtIcon
          v-if="downloadAvailable"
          class="downloadAvailableIcon"
          :icon="['fas', 'download']"
          :title="t('Downloads.Available Offline')"
        />
      </p>
      <FtListVideo
        :data="data"
        :playlist-id="playlistId"
        :playlist-type="playlistType"
        :playlist-index="playlistIndex"
        :playlist-reverse="playlistReverse"
        :playlist-shuffle="playlistShuffle"
        :playlist-loop="playlistLoop"
        :playlist-item-id="playlistItemId"
        :download-id="downloadId"
        force-list-type="list"
        :appearance="appearance"
        :always-show-add-to-playlist-button="alwaysShowAddToPlaylistButton"
        :quick-bookmark-button-enabled="quickBookmarkButtonEnabled"
        :can-move-video-up="canMoveVideoUp"
        :can-move-video-down="canMoveVideoDown"
        :can-remove-from-playlist="canRemoveFromPlaylist"
        @pause-player="pausePlayer"
        @move-video-up="moveVideoUp"
        @move-video-down="moveVideoDown"
        @move-video-to-the-top="moveVideoToTheTop"
        @move-video-to-the-bottom="moveVideoToTheBottom"
        @remove-from-playlist="removeFromPlaylist"
      />
    </template>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePlaylistDrag } from '../../composables/usePlaylistDrag'
import { vFirstVisible } from '../../helpers/firstVisible'
import { observeWindowedListItem } from '../../helpers/windowedList'
import store from '../../store/index'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

import FtListVideo from '../FtListVideo/FtListVideo.vue'

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
  downloadId: {
    type: String,
    default: '',
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
  draggedVideo: {
    type: Object,
    default: () => ({ videoId: null, playlistItemId: null }),
  },
  isSortOrderCustom: {
    type: Boolean,
    default: null
  },
  isVideoDragging: {
    type: Boolean,
    default: false,
  },
  videoIndex: {
    type: Number,
    default: -1
  },
  isCurrentVideo: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'move-dragged-video',
  'move-video-down',
  'move-video-up',
  'move-video-to-the-top',
  'move-video-to-the-bottom',
  'pause-player',
  'remove-from-playlist',
  'drag-video',
  'drag-video-end'
])
const visible = ref(props.initialVisibleState)
const { t } = useI18n()
const downloadAvailable = computed(() => {
  if (!props.downloadId) return false
  const download = store.getters.getYtDlpDownloads[props.downloadId]
  return download?.files?.some(file => file.videoId === props.data.videoId && file.available !== false) ?? false
})

const inUserPlaylist = props.playlistType === 'user'
const canBecomeDraggable = computed(() => inUserPlaylist && props.isSortOrderCustom && (props.canMoveVideoUp || props.canMoveVideoDown))
const { dragVideo, moveDraggedVideo, afterDrag, pointerDragging, startPointerDrag, moveWithKeyboard } = usePlaylistDrag(emit)
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

let stopWatchingInitialVisibleState = null

if (!props.initialVisibleState) {
  stopWatchingInitialVisibleState = watch(() => props.initialVisibleState, (newValue) => {
    visible.value = newValue
    stopWatchingInitialVisibleState()
    stopWatchingInitialVisibleState = null
  })
}

// Long playlists release distant rows to measured shells. Mounted rows would
// otherwise accumulate while scrolling and slow down every style update.
const windowed = process.env.IS_CAPACITOR || process.env.IS_ELECTRON
const row = useTemplateRef('row')
const shellHeight = ref(0)
if (windowed) {
  let windowItem = null
  watch(row, element => {
    windowItem?.dispose()
    windowItem = null
    if (!element) return
    windowItem = observeWindowedListItem(element, {
      mount: onFirstVisible,
      unmount: height => { shellHeight.value = height; visible.value = false },
      isMounted: () => visible.value,
      isProtected: () => props.isVideoDragging || pointerDragging.value ||
        element.contains(document.activeElement) ||
        !!element.querySelector('[aria-expanded="true"], [role="dialog"]'),
    })
  }, { flush: 'post' })
  onBeforeUnmount(() => windowItem?.dispose())
}

async function onFirstVisible() {
  if (visible.value) return

  // A slow renderer can report a row after its list already scrolled past it,
  // for example after centering the current video. Without native scroll
  // anchoring (phone panels disable it), the growing row would push the visible
  // rows down, so keep them in place ourselves.
  const element = row.value
  const scroller = element?.parentElement
  const placeholderBounds = scroller != null && getComputedStyle(scroller).overflowAnchor === 'none'
    ? element.getBoundingClientRect()
    : null
  const aboveViewport = placeholderBounds != null &&
    placeholderBounds.bottom <= scroller.getBoundingClientRect().top

  visible.value = true

  if (stopWatchingInitialVisibleState) {
    stopWatchingInitialVisibleState()
    stopWatchingInitialVisibleState = null
  }

  if (aboveViewport) {
    await nextTick()
    const growth = element.getBoundingClientRect().height - placeholderBounds.height
    if (growth !== 0) restoreOverlayScrollTop(scroller, scroller.scrollTop + growth)
  }
}

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

/**
 * @param {string} videoId
 * @param {string} playlistItemId
 */
function removeFromPlaylist(videoId, playlistItemId) {
  emit('remove-from-playlist', videoId, playlistItemId)
}
</script>

<style scoped src="./FtListVideoNumbered.css" />
