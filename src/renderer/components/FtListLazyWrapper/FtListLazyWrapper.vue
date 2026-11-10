<template>
  <div
    v-if="showResult"
    ref="shell"
    v-first-visible="(windowed && !deferWindowing) || windowItemObserved || visible ? false : onFirstVisible"
    :style="!visible && shellHeight ? { blockSize: `${shellHeight}px` } : undefined"
    :class="{
      grid: layout === 'grid',
      list: layout === 'list',
      draggable: isDraggable,
    }"
    :data-playlist-drag-item="isDraggable ? '' : null"
    :data-video-id="videoData.videoId"
    :data-playlist-item-id="videoData.playlistItemId"
    @keydown="isDraggable && moveWithKeyboard($event, videoData)"
  >
    <template
      v-if="visible"
    >
      <FtBlockedItem
        :blocked="blocked"
        :reveal-key="blockedRevealKey"
      >
        <FtListVideo
          v-if="finalDataType === 'video' || finalDataType === 'shortVideo'"
          :appearance="appearance"
          :data="displayedData"
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
          :force-list-type="layout"
          :show-grab-bar="showGrabBar && layout === 'grid'"
          :grab-bar-enabled="isDraggable && layout === 'grid'"
          @move-video-up="moveVideoUp"
          @move-video-down="moveVideoDown"
          @move-video-to-the-top="moveVideoToTheTop"
          @move-video-to-the-bottom="moveVideoToTheBottom"
          @remove-from-playlist="removeFromPlaylist"
        />
        <FtListChannel
          v-else-if="finalDataType === 'channel'"
          :appearance="appearance"
          :data="displayedData"
        />
        <FtListPlaylist
          v-else-if="finalDataType === 'playlist'"
          :appearance="appearance"
          :data="displayedData"
          :search-query-text="searchQueryText"
          :show-grab-bar="isDraggable"
        />
        <FtCommunityPost
          v-else-if="finalDataType === 'community'"
          :hide-forbidden-titles="hideForbiddenTitles"
          :appearance="appearance"
          :data="displayedData"
        />
        <FtListHashtag
          v-else-if="data.type === 'hashtag'"
          :appearance="appearance"
          :data="displayedData"
        />
      </FtBlockedItem>
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, useTemplateRef, watch } from 'vue'
import { observeWindowedListItem, WINDOWED_LIST_OVERSCAN_PX } from '../../helpers/windowedList.js'
import { vFirstVisible } from '../../helpers/firstVisible'

import { usePlaylistDrag } from '../../composables/usePlaylistDrag'

import FtBlockedItem from '../FtBlockedItem/FtBlockedItem.vue'
import FtListVideo from '../FtListVideo/FtListVideo.vue'
import {
  FtCommunityPost,
  FtListChannel,
  FtListHashtag,
  FtListPlaylist,
} from './lazyListComponents'

import store from '../../store/index'
import { isOnAiSlopList } from '../../helpers/aiSlopList'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'

const props = defineProps({
  dataOverrides: {
    type: Object,
    default: null
  },
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
  hideMembersOnly: {
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
  isVideoDragging: {
    type: Boolean,
    default: false,
  },
  videoDraggingPossible: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'move-video-down',
  'move-video-up',
  'move-video-to-the-top',
  'move-video-to-the-bottom',
  'remove-from-playlist'
])

const inUserPlaylist = props.playlistType === 'user'
// Playlist cards reorder with the same events, keyed by their playlist ID.
const isPlaylistCard = (props.data.type ?? props.dataType) === 'playlist'
const showGrabBar = computed(() => (inUserPlaylist || isPlaylistCard) && props.videoDraggingPossible)
const isDraggable = computed(() => showGrabBar.value && (props.canMoveVideoUp || props.canMoveVideoDown))
// The list drags its items with useGridReorder; items only take keyboard moves here.
const { moveWithKeyboard } = usePlaylistDrag(emit)

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

/** Lists keep block list matches and blur them instead of removing them */
const blurBlockedItems = computed(() => store.getters.getBlurBlockedItemsActive)

/** @type {import('vue').ComputedRef<Set<string>>} */
const channelsHiddenNames = computed(() => {
  // Some component users like channel view will have this disabled
  if (!props.useChannelsHiddenPreference) { return EMPTY_SET }

  return store.getters.getActiveChannelsHiddenNames
})

/** @type {import('vue').ComputedRef<Set<string>>} */
const aiSlopChannels = computed(() => {
  if (!props.useChannelsHiddenPreference) { return EMPTY_SET }

  return store.getters.getAiSlopBlockedChannels
})

/** @type {import('vue').ComputedRef<string[]>} */
const forbiddenTitles = computed(() => {
  if (!props.hideForbiddenTitles) { return [] }
  return store.getters.getActiveForbiddenTitles
})

/**
 * @param {{
 *   hiddenChannelNames: Set<string>,
 *   forbiddenTitles: string[],
 *   otherFilters: boolean,
 * }} filters `otherFilters` adds the filters that always remove items
 */
function isHidden({ hiddenChannelNames, forbiddenTitles, otherFilters }) {
  const dataType = finalDataType.value

  if (dataType === 'video' || dataType === 'shortVideo') {
    return isVideoHiddenByPreferences(props.data, {
      hideLiveStreams: otherFilters && hideLiveStreams.value,
      hideUpcomingPremieres: otherFilters && hideUpcomingPremieres.value,
      hiddenChannelNames,
      aiSlopChannels: otherFilters ? aiSlopChannels.value : EMPTY_SET,
      forbiddenTitles,
      membersOnlyChannelIds: otherFilters && props.hideMembersOnly ? store.getters.getMembersOnlyChannelIdSet : null
    })
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

    // hide channels by author
    return attrsToCheck.some(a => a != null && hiddenChannelNames.has(a)) ||
      (otherFilters && isOnAiSlopList(aiSlopChannels.value, {
        authorId: props.data.id ?? props.data.authorId,
        authorHandle: props.data.handle ?? props.data.channelHandle
      })) ||
      (lowerCaseName != null && forbiddenTitles.some((text) => lowerCaseName.includes(text)))
  } else if (dataType === 'playlist') {
    const lowerCaseTitle = props.data.title?.toLowerCase()
    const lowerCaseChannelName = props.data.channelName?.toLowerCase()

    if ((lowerCaseTitle != null && forbiddenTitles.some((text) => lowerCaseTitle.includes(text))) ||
      (lowerCaseChannelName != null && forbiddenTitles.some((text) => lowerCaseChannelName.includes(text)))) {
      return true
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

    // hide playlists by author
    return attrsToCheck.some(a => a != null && hiddenChannelNames.has(a))
  }
  return false
}

const showResult = computed(() => {
  if (!finalDataType.value) {
    return false
  }

  return !isHidden({
    hiddenChannelNames: blurBlockedItems.value ? EMPTY_SET : channelsHiddenNames.value,
    forbiddenTitles: blurBlockedItems.value ? [] : forbiddenTitles.value,
    otherFilters: true,
  })
})

const blocked = computed(() => {
  if (!blurBlockedItems.value) {
    return false
  }

  // Feeds remove posts by blocked authors themselves when blocked items are hidden
  if (finalDataType.value === 'community') {
    const lowerCaseAuthor = props.data.author?.toLowerCase()
    return lowerCaseAuthor != null && forbiddenTitles.value.some((text) => lowerCaseAuthor.includes(text))
  }

  return isHidden({
    hiddenChannelNames: channelsHiddenNames.value,
    forbiddenTitles: forbiddenTitles.value,
    otherFilters: false,
  })
})

const blockedRevealKey = computed(() => {
  const data = props.data
  return data.videoId ?? data.playlistId ?? data.postId ?? data.id ?? data.authorId ?? null
})

const visible = ref(props.firstScreen)
// Evaluate only when the card mounts. Metadata edits remain reactive without
// copying every cached entry before pagination or lazy rendering.
const displayedData = computed(() => props.dataOverrides
  ? { ...reactive(props.data), ...props.dataOverrides }
  : props.data)
// Community cards contain expandable text/media whose local state must survive scrolling.
const windowed = (process.env.IS_CAPACITOR || process.env.IS_ELECTRON) && finalDataType.value !== 'community'
const deferWindowing = process.env.IS_ELECTRON
const shell = useTemplateRef('shell')
const shellHeight = ref(0)
const windowItemObserved = ref(false)
let windowItem
if (windowed) {
  function startWindowing(element) {
    windowItem = observeWindowedListItem(element, {
      mount: () => { visible.value = true },
      unmount: height => { shellHeight.value = height; visible.value = false },
      isMounted: () => visible.value,
      isProtected: () => {
        let nearViewport = false
        if (deferWindowing) {
          if (!element.isConnected) return true
          // KeepAlive can report an old intersection as a feed tab reattaches.
          const bounds = element.getBoundingClientRect()
          nearViewport = bounds.bottom > -WINDOWED_LIST_OVERSCAN_PX &&
            bounds.top < window.innerHeight + WINDOWED_LIST_OVERSCAN_PX
        }
        return nearViewport || props.isVideoDragging ||
          element.contains(document.activeElement) ||
          !!element.querySelector('[aria-expanded="true"], [role="dialog"], [contenteditable="true"]')
      },
    })
    windowItemObserved.value = true
  }
  watch(shell, element => {
    windowItem?.dispose()
    windowItem = null
    windowItemObserved.value = false
    if (element && (!deferWindowing || visible.value)) startWindowing(element)
  }, { flush: 'post' })
  if (deferWindowing) {
    watch(visible, isVisible => {
      if (isVisible && shell.value && !windowItem) startWindowing(shell.value)
    }, { flush: 'post' })
  }
  watch(() => [props.data, props.layout, props.appearance], () => windowItem?.refresh(), { flush: 'post' })
  // Two-line titles and text settings change row heights without a resize that remeasures shells.
  watch(
    [() => store.getters.getLimitTitlesToTwoLines, () => store.getters.getFontSize, () => store.getters.getAppFont],
    () => windowItem?.remeasure(),
    { flush: 'post' }
  )
  onBeforeUnmount(() => windowItem?.dispose())
}

function onFirstVisible() {
  visible.value = true
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

/** @import { VideoData } from '../../helpers/dragAndDrop' */

/** @type {VideoData} */
const videoData = isPlaylistCard
  ? { videoId: props.data._id ?? props.data.playlistId, playlistItemId: props.data._id ?? props.data.playlistId }
  : { videoId: props.data.videoId, playlistItemId: props.playlistItemId }

</script>

<style scoped src="./FtListLazyWrapper.css" />
