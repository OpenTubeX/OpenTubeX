<template>
  <FtAutoGrid
    ref="elementList"
    class="elementList"
    :grid="displayValue !== 'list'"
    :thumbnail-size="thumbnailSize"
  >
    <template
      v-for="(result, index) in data"
      :key="`${dataType || result.type}-${result.videoId || result.playlistId || result.postId || result.id || result._id || result.authorId || result.title}-${result.playlistItemId || index}-${result.lastUpdatedAt || 0}`"
    >
      <FtListLazyWrapper
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
        :data-element-list-index="index"
        @drag-video="dragVideo"
        @move-dragged-video="moveDraggedVideo"
        @drag-video-end="afterDrag"
        @move-video-up="moveVideoUp"
        @move-video-down="moveVideoDown"
        @remove-from-playlist="removeFromPlaylist"
      />
      <div
        v-if="(displayValue === 'list' || gridColumnCount === 1) && index === newSubscriptionEntriesEndIndex"
        class="newSubscriptionIndicator"
        role="separator"
      >
        <span>{{ t('Subscriptions.New Content') }}</span>
      </div>
    </template>
    <div
      v-if="displayValue === 'grid' && gridColumnCount > 1 && firstPreviouslyFetchedIndex > 0"
      class="newSubscriptionGridIndicator"
      role="separator"
      :style="newSubscriptionGridIndicatorStyle"
    >
      <span>{{ t('Subscriptions.New Content') }}</span>
    </div>
  </FtAutoGrid>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'
import FtListLazyWrapper from '../FtListLazyWrapper/FtListLazyWrapper.vue'

import store from '../../store/index'

const { t } = useI18n()
const elementList = useTemplateRef('elementList')
const newSubscriptionGridIndicatorStyle = ref({ visibility: 'hidden' })
const gridColumnCount = ref(0)
let gridResizeObserver = null

const props = defineProps({
  data: {
    type: Array,
    required: true
  },
  dataType: {
    type: String,
    default: null,
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
  showNewSubscriptionFeedIndicator: {
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

const newSubscriptionEntriesEndIndex = computed(() => {
  if (!props.showNewSubscriptionFeedIndicator) {
    return -1
  }

  return firstPreviouslyFetchedIndex.value > 0 ? firstPreviouslyFetchedIndex.value - 1 : -1
})

const firstPreviouslyFetchedIndex = computed(() => {
  if (!props.showNewSubscriptionFeedIndicator) {
    return -1
  }

  return props.data.findIndex(entry => entry.isNewInSubscriptionFeed !== true)
})

function updateNewSubscriptionGridIndicatorPosition() {
  if (displayValue.value !== 'grid') {
    gridColumnCount.value = 0
    newSubscriptionGridIndicatorStyle.value = { visibility: 'hidden' }
    return
  }

  const gridElement = elementList.value?.$el

  if (!gridElement) {
    newSubscriptionGridIndicatorStyle.value = { visibility: 'hidden' }
    return
  }

  const gridRect = gridElement.getBoundingClientRect()
  const cardRect = gridElement.closest('.ft-card')?.getBoundingClientRect() ?? gridRect
  gridColumnCount.value = getComputedStyle(gridElement).gridTemplateColumns.split(' ').length

  if (gridColumnCount.value <= 1 || firstPreviouslyFetchedIndex.value <= 0) {
    newSubscriptionGridIndicatorStyle.value = { visibility: 'hidden' }
    return
  }

  const previousItem = gridElement.querySelector(`[data-element-list-index="${firstPreviouslyFetchedIndex.value - 1}"]`)
  const currentItem = gridElement.querySelector(`[data-element-list-index="${firstPreviouslyFetchedIndex.value}"]`)

  if (!previousItem || !currentItem) {
    newSubscriptionGridIndicatorStyle.value = { visibility: 'hidden' }
    return
  }

  const currentItemRect = currentItem.getBoundingClientRect()
  const previousRect = (previousItem.querySelector('.thumbnailImage') ?? previousItem).getBoundingClientRect()
  const currentRect = (currentItem.querySelector('.thumbnailImage') ?? currentItem).getBoundingClientRect()
  const isRtl = getComputedStyle(gridElement).direction === 'rtl'
  const itemsShareRow = Math.abs(previousRect.top - currentRect.top) < 1
  let boundaryPosition

  if (itemsShareRow) {
    boundaryPosition = isRtl
      ? (previousRect.left + currentRect.right) / 2
      : (previousRect.right + currentRect.left) / 2
  } else {
    boundaryPosition = isRtl
      ? (cardRect.right + currentRect.right) / 2
      : (cardRect.left + currentRect.left) / 2
  }

  const indicatorHeight = Math.min(180, Math.max(currentItemRect.height - 30, 0))
  const indicatorTop = currentItemRect.top - gridRect.top + (currentItemRect.height - indicatorHeight) / 2

  newSubscriptionGridIndicatorStyle.value = {
    blockSize: `${indicatorHeight}px`,
    insetBlockStart: `${indicatorTop}px`,
    insetInlineStart: `${isRtl ? gridRect.right - boundaryPosition : boundaryPosition - gridRect.left}px`,
    transform: `translateX(${isRtl ? '50%' : '-50%'})`,
    visibility: 'visible'
  }
}

async function refreshNewSubscriptionGridIndicatorPosition() {
  await nextTick()
  updateNewSubscriptionGridIndicatorPosition()
}

onMounted(() => {
  const gridElement = elementList.value?.$el
  if (gridElement) {
    gridResizeObserver = new ResizeObserver(updateNewSubscriptionGridIndicatorPosition)
    gridResizeObserver.observe(gridElement)
  }
  refreshNewSubscriptionGridIndicatorPosition()
})

onBeforeUnmount(() => {
  gridResizeObserver?.disconnect()
})

watch([displayValue, firstPreviouslyFetchedIndex, () => props.data], refreshNewSubscriptionGridIndicatorPosition)

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
