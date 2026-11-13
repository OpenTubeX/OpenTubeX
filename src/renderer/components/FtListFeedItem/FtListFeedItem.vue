<template>
  <div
    class="videoSwipeFrame"
    :class="{
      thumbnailSwipeEnabled,
      videoSwipeActive: thumbnailSwipe,
      videoSwipeDragging: thumbnailSwipe && !thumbnailSwipe.settling,
    }"
    :style="{
      '--video-swipe-offset': `${thumbnailSwipe?.offset ?? 0}px`,
      '--video-swipe-progress': thumbnailSwipe?.progress ?? 0,
    }"
    @pointerdown="startThumbnailSwipe"
    @pointermove="moveThumbnailSwipe"
    @pointerup="finishThumbnailSwipe"
    @pointercancel="abortThumbnailSwipe"
    @lostpointercapture.self="abortThumbnailSwipe"
  >
    <div
      v-if="thumbnailSwipe"
      :key="thumbnailSwipe.direction"
      class="thumbnailSwipeFeedback"
      :class="{
        thumbnailSwipeReady: thumbnailSwipe.progress === 1,
        thumbnailSwipeLeft: thumbnailSwipe.direction === 'left',
      }"
      :title="thumbnailSwipe.action.label"
      aria-hidden="true"
    >
      <FtIcon :icon="thumbnailSwipe.action.icon" />
    </div>
    <div
      class="ft-list-video ft-list-item result"
      :class="{ grid: layout === 'grid', list: layout === 'list', watched: showWatchedStyle && watchProgress?.watched }"
      @contextmenu="openContextMenu"
      @keydown="handleTileKeydown"
      @pointerdown="startMenuHold"
      @pointermove="moveMenuHold"
      @pointerup="cancelMenuHold"
      @pointercancel="cancelMenuHold"
      @dragstart="handleMenuHoldDragStart"
    >
      <div class="videoThumbnail">
        <RouterLink
          class="thumbnailLink"
          tabindex="-1"
          :to="to"
          :aria-label="data.title"
          @click="markAsSeen"
          @auxclick.middle="markAsSeen"
        >
          <FtRetryImage
            v-if="thumbnail"
            :src="thumbnail"
            class="thumbnailImage"
            :class="{ blur: blurThumbnails }"
            alt=""
          />
          <span
            v-else
            class="thumbnailImage thumbnailPlaceholder"
          >
            <FtIcon
              :icon="placeholderIcon ?? platformIcon ?? ['fas', 'rss']"
              aria-hidden="true"
            />
          </span>
          <FtEmbeddedProgress
            v-if="watchProgress"
            class="watchedProgressBar"
            :progress="watchProgress.progress * 100"
            :corner-radius="thumbnailProgressRadius"
            :end-arc-fraction="0.5"
            :line-width="3"
            :start-arc-fraction="0.5"
          />
        </RouterLink>
        <div
          v-if="data.isLive || durationText"
          class="videoDuration"
          :class="{ live: data.isLive }"
        >
          {{ data.isLive ? t('Video.Live') : durationText }}
        </div>
        <div
          v-if="showWatchedStyle && watchProgress?.watched"
          class="videoWatched"
        >
          {{ t('Video.Watched') }}
        </div>
      </div>
      <div class="info">
        <RouterLink
          class="title"
          :to="to"
          :title="store.getters.getTitleLineLimit > 0 ? data.title : null"
          @click="markAsSeen"
          @auxclick.middle="markAsSeen"
        >
          <h3
            class="h3Title"
            dir="auto"
          >
            <FtNewContentDot v-if="showNewIndicator" />{{ data.title }}
          </h3>
        </RouterLink>
        <div class="infoLine">
          <component
            :is="channelRoute ? 'router-link' : 'bdi'"
            v-if="data.author || platform"
            class="channelName"
            dir="auto"
            :to="channelRoute ?? undefined"
          >
            <FtChannelAvatar
              v-if="avatar && !hideChannelAvatars"
              :thumbnail="avatar"
            />
            <span class="channelNameText">{{ data.author }}</span>
            <FtIcon
              v-if="platform"
              class="platformIcon"
              :icon="platformIcon"
              :title="platform.name"
            />
          </component>
          <FtInlineMetadata
            v-if="publishedText || viewCountText"
            class="videoInfo"
            icon-labels
          >
            <span
              v-if="viewCountText"
              class="viewCount"
            ><FtIcon
              :icon="['fas', data.isLive ? 'users' : 'eye']"
              class="statIcon"
              aria-hidden="true"
            />{{ viewCountText }}</span>
            <span
              v-if="publishedText"
              class="uploadedTime"
            ><FtIcon
              :icon="['fas', 'clock']"
              class="statIcon"
              aria-hidden="true"
            />{{ publishedText }}</span>
          </FtInlineMetadata>
        </div>
        <div class="buttonStack">
          <FtIconButton
            v-if="store.getters.getShowVideoMenuButton"
            ref="menuButton"
            class="optionsButton"
            :title="t('Video.More Options')"
            :icon="['fas', 'ellipsis-v']"
            theme="base-no-default"
            :size="16"
            @click="openOptionsMenu"
          />
        </div>
      </div>
      <WatchVideoDownloadPrompt
        v-if="canDownload && showDownloadPrompt"
        :external-url="data.url"
        :title="data.title"
        :thumbnail="thumbnail"
        @close="showDownloadPrompt = false"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, inject, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtChannelAvatar from '../FtChannelAvatar/FtChannelAvatar.vue'
import FtEmbeddedProgress from '../FtEmbeddedProgress/FtEmbeddedProgress.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInlineMetadata from '../FtInlineMetadata/FtInlineMetadata.vue'
import FtNewContentDot from '../FtNewContentDot/FtNewContentDot.vue'
import FtRetryImage from '../FtRetryImage.vue'
import WatchVideoDownloadPrompt from '../WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'

import store from '../../store/index'
import { useCardContextMenu } from '../../composables/useCardContextMenu'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { useThumbnailSwipe } from '../../composables/useThumbnailSwipe'
import { getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import { formatDate } from '../../helpers/dateFormat.js'
import { getExternalMediaAuthorId, getExternalMediaHistoryId } from '../../helpers/externalMediaHistory'
import { isHistoryEntryWatched } from '../../helpers/history'
import { lightHaptic } from '../../helpers/mobileHaptics'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import { markRssFeedItemsAsSeen, markRssFeedItemsAsUnseen } from '../../helpers/rssFeeds'
import {
  copyToClipboard,
  formatDurationAsTimestamp,
  formatViewCount,
  getRelativeTimeFromDate,
  openExternalLink,
  openInternalPath,
  shareLink,
  showToast
} from '../../helpers/utils'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { isTileMarkShortcut, tileKeyboardShortcutsKey } from '../../helpers/tileNavigation'
import { getPlatform, getPlatformChannelRoute, PLATFORM_ICONS } from '../../../platforms/index'

const props = defineProps({
  /**
   * Items from other platforms can also say how long they are, how often they
   * were viewed, and whether they are live.
   * @type {import('vue').PropType<import('../../helpers/rssFeeds').RssFeedItem & { duration?: number, viewCount?: number, isLive?: boolean }>}
   */
  data: {
    type: Object,
    required: true
  },
  layout: {
    type: String,
    default: 'grid'
  },
  /** The avatar of the feed's creator */
  avatar: {
    type: String,
    default: null
  },
  /** The New feed only lists new items, so they don't need a dot */
  inNewFeed: {
    type: Boolean,
    default: false
  },
  /** Whether the item can be marked as seen, like the items of RSS feeds */
  seenActions: {
    type: Boolean,
    default: true
  },
  /**
   * Saves the seen marks of items from other sources than RSS feeds
   * @type {import('vue').PropType<{ markSeen: (items: object[]) => void, markUnseen: (items: object[]) => void } | null>}
   */
  seenMarks: {
    type: Object,
    default: null
  },
  /** Shown instead of a missing thumbnail, by default the icon of the item's platform */
  placeholderIcon: {
    type: Array,
    default: null
  },
  /** Like YouTube videos in the history, watched items are dimmed */
  showWatchedStyle: {
    type: Boolean,
    default: true
  },
  /** Like for YouTube videos, the history shows when items were published instead of how long ago */
  exactDates: {
    type: Boolean,
    default: false
  }
})

const { t, locale } = useI18n()

const now = useRelativeTimeClock()
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)
// The Hidden thumbnail preference shows the placeholder instead, so the image is never fetched.
const thumbnail = computed(() => store.getters.getThumbnailPreference === 'hidden' ? '' : props.data.thumbnail)
const hideChannelAvatars = computed(() => store.getters.getHideChannelAvatars)
const thumbnailProgressRadius = computed(() => 8 * store.getters.getUiRoundness / 100)
// The external media page adds everything it plays to the history. Live
// streams play from the channel's address, which every broadcast shares, so
// they show no progress.
const historyId = computed(() => getExternalMediaHistoryId(props.data.url))
const historyEntry = computed(() => historyId.value ? store.getters.getHistoryCacheById[historyId.value] : undefined)
const position = computed(() => {
  const entry = historyEntry.value
  if (!entry || props.data.isLive) return null
  const seconds = Number.isFinite(entry.watchProgress) ? entry.watchProgress : 0
  if (isHistoryEntryWatched(entry)) return { watched: true, progress: 1, seconds }
  const duration = entry.lengthSeconds > 0 ? entry.lengthSeconds : props.data.duration
  return { watched: false, progress: duration > 0 ? Math.min(seconds / duration, 1) : 0, seconds }
})
const watchProgress = computed(() => position.value?.progress > 0 ? position.value : null)
const to = computed(() => ({ path: '/external-media', query: { url: props.data.url } }))
// Items from other platforms link to the page of their channel
const platform = computed(() => getPlatform(props.data.platform))
const platformIcon = computed(() => platform.value ? PLATFORM_ICONS[platform.value.id] : null)
const channelRoute = computed(() => platform.value && props.data.channelId
  ? getPlatformChannelRoute(platform.value.id, props.data.channelId)
  : null)
// Live streams show their viewers instead of their start
const publishedText = computed(() => {
  if (props.data.published === null || props.data.isLive) return ''
  return props.exactDates
    ? formatDate(props.data.published, locale.value, store.getters.getDateFormat, { year: 'numeric', month: 'numeric', day: 'numeric' })
    : getRelativeTimeFromDate(props.data.published, false, true, now.value)
})
const durationText = computed(() => props.data.duration > 0 ? formatDurationAsTimestamp(props.data.duration) : '')
const viewCountText = computed(() => {
  const count = props.data.viewCount
  if (!Number.isFinite(count) || store.getters.getHideVideoViews) return ''
  const formatted = formatViewCount(count, store.getters.getShortenViewCounts)
  return props.data.isLive
    ? t('Global.Counts.Watching Count', { count: formatted }, count)
    : t('Global.Counts.View Count', { count: formatted }, count)
})

const showNewIndicator = computed(() => store.getters.getShowNewSubscriptionFeedIndicators &&
  props.data.isNew === true && !props.inNewFeed && !position.value?.watched)
const showMarkAsSeen = computed(() => props.seenActions && props.data.isNew === true && (props.inNewFeed || showNewIndicator.value))
// Like subscription videos, items that aren't new can come back to the New feed,
// and so can new items that it leaves out because they were watched
const showMarkAsUnseen = computed(() => props.seenActions && !props.inNewFeed &&
  (props.data.isNew !== true || position.value?.watched === true))

function markAsSeen() {
  if (props.data.isNew !== true) return
  const markSeen = props.seenMarks?.markSeen ?? markRssFeedItemsAsSeen
  markSeen([props.data])
}

function markAsUnseen() {
  // The New feed leaves out watched items
  if (position.value?.watched) store.dispatch('updateHistory', { ...historyEntry.value, isWatched: false })
  const markUnseen = props.seenMarks?.markUnseen ?? markRssFeedItemsAsUnseen
  markUnseen([props.data])
}

const showDownloadPrompt = ref(false)
const canDownload = computed(() => supportsYtDlp && store.getters.getEnableDownloads)
watch(canDownload, (enabled) => {
  if (!enabled) showDownloadPrompt.value = false
})

function setWatched(watched, fully = false) {
  const entry = historyEntry.value
  if (watched) {
    const lengthSeconds = entry?.lengthSeconds > 0 ? entry.lengthSeconds : (props.data.duration ?? 0)
    // Like YouTube videos, the item keeps its history details and only gains them when it has none.
    store.dispatch('updateHistory', {
      videoId: historyId.value,
      title: props.data.title,
      author: props.data.author,
      authorId: getExternalMediaAuthorId(props.data.platform, props.data.channelId),
      ...(props.avatar ? { authorThumbnail: props.avatar } : {}),
      thumbnail: props.data.thumbnail,
      published: props.data.published ?? 0,
      description: '',
      ...(Number.isFinite(props.data.viewCount) ? { viewCount: props.data.viewCount } : {}),
      isLive: false,
      isUpcoming: false,
      type: 'video',
      ...entry,
      lengthSeconds,
      watchProgress: fully ? lengthSeconds : (entry?.watchProgress ?? 0),
      isWatched: true,
      timeWatched: entry?.timeWatched ?? Date.now(),
    })
    markAsSeen()
  } else if (store.getters.getWatchedPercentageThreshold === 0) {
    store.dispatch('removeFromHistory', historyId.value)
  } else {
    store.dispatch('updateHistory', { ...entry, isWatched: false })
  }
  showToast({
    message: watched ? t('Video.Video has been marked as watched') : t('Video.Video has been unmarked as watched'),
    image: thumbnail.value || null,
    icon: ['fas', watched ? 'eye' : 'eye-slash']
  })
}

function removeFromHistory() {
  store.dispatch('removeFromHistory', historyId.value)
  showToast({
    message: t('Video.Video has been removed from your history'),
    image: thumbnail.value || null,
    icon: ['fas', 'trash']
  })
}

function openElsewhere({ newWindow = false, background = false } = {}) {
  openInternalPath({ ...to.value, title: props.data.title, doCreateNewTab: !newWindow, doCreateNewWindow: newWindow, makeActive: !background })
  markAsSeen()
}

const copyLinkItem = computed(() => ({
  label: t('Share.Copy Link'),
  icon: ['fas', 'link'],
  run: () => copyToClipboard(props.data.url)
}))
const shareLinkItem = computed(() => process.env.IS_CAPACITOR
  ? { label: t('Share.Share Link'), icon: ['fas', 'share-alt'], run: () => shareLink(props.data.url) }
  : null)
const downloadItem = computed(() => canDownload.value
  ? { label: t('Downloads.Download Video'), icon: ['fas', 'download'], run: () => { showDownloadPrompt.value = true } }
  : null)

const menuItems = computed(() => {
  const watched = position.value?.watched === true
  const items = []
  if (store.getters.getTabsEnabled) {
    items.push({
      label: t('Context Menu.Open in a New Tab'),
      shortLabel: t('New Tab'),
      icon: ['fas', 'arrow-up-right-from-square'],
      quickAction: true,
      run: () => openElsewhere()
    })
  }
  if (process.env.IS_ELECTRON) {
    items.push({
      label: t('Context Menu.Open in a New Window'),
      shortLabel: t('New Window'),
      icon: ['fas', 'external-link-alt'],
      quickAction: true,
      run: () => openElsewhere({ newWindow: true })
    })
  }
  if (items.length > 0) items.push({ type: 'separator' })
  if (!props.data.isLive) {
    items.push({
      label: watched ? t('Video.Unmark As Watched') : t('Video.Mark As Watched'),
      icon: ['fas', watched ? 'eye-slash' : 'eye'],
      run: () => setWatched(!watched)
    })
  }
  // Without a saved position, marking it as watched already starts it over next time
  if (position.value?.seconds > 0 && position.value.seconds < (historyEntry.value.lengthSeconds || Infinity) - 2) {
    items.push({
      label: t('Video.Mark As Fully Watched'),
      icon: ['fas', 'flag-checkered'],
      run: () => setWatched(true, true)
    })
  }
  if (showMarkAsSeen.value) {
    items.push({
      label: t('Subscriptions.Mark As Seen'),
      icon: ['fas', 'check'],
      run: markAsSeen
    })
  }
  if (showMarkAsUnseen.value) {
    items.push({
      label: t('Subscriptions.Mark As Unseen'),
      icon: ['fas', 'eye-slash'],
      run: markAsUnseen
    })
  }
  if (historyEntry.value) {
    items.push({
      label: t('Video.Remove From History'),
      icon: ['fas', 'trash'],
      run: removeFromHistory
    })
  }
  if (downloadItem.value) items.push(downloadItem.value)
  items.push({ type: 'separator' }, copyLinkItem.value, {
    // Feeds that aren't from a supported platform link to any website
    label: platform.value ? t('Platforms.Open Website', { platform: platform.value.name }) : t('Share.Open Link'),
    icon: platformIcon.value ?? ['fas', 'external-link-alt'],
    run: () => openExternalLink(props.data.url)
  })
  if (shareLinkItem.value) items.push(shareLinkItem.value)
  return items.map(item => item.type === 'separator' ? item : { enabled: true, ...item })
})

// Like on YouTube videos, phones can open the item without leaving the page
const thumbnailActions = computed(() => (process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && store.getters.getTabsEnabled
  ? [{
      label: t('Context Menu.Open in a Background Tab'),
      shortLabel: t('Context Menu.Background Tab'),
      icon: ['fas', 'clone'],
      enabled: true,
      run: () => openElsewhere({ background: true })
    }]
  : [])

const menuButton = useTemplateRef('menuButton')
const {
  startMenuHold, moveMenuHold, cancelMenuHold, handleMenuHoldDragStart, suppressMenuHoldClick,
  openContextMenu, openOptionsMenu: openCardOptionsMenu, handleMenuKeydown,
} = useCardContextMenu({ items: menuItems, title: () => props.data.title, thumbnailActions, beforeOpen: () => cancelThumbnailSwipe() })

function openOptionsMenu() {
  openCardOptionsMenu(menuButton.value.$el.querySelector('button'))
}

/**
 * The swipe actions from the settings that apply to items from other
 * platforms. Playlists, bookmarks and the queue only take YouTube videos.
 * @param {'left' | 'right'} direction
 */
function getThumbnailSwipeAction(direction) {
  const actionId = direction === 'left'
    ? store.getters.getThumbnailLeftSwipeAction
    : store.getters.getThumbnailRightSwipeAction
  const watched = position.value?.watched === true
  switch (actionId) {
    case 'history':
    case 'markAsFullySeen':
      if (props.data.isLive) return null
      // Like on YouTube videos, a watched item is unmarked instead
      if (actionId === 'history' || watched) {
        return {
          label: watched ? t('Video.Unmark As Watched') : t('Video.Mark As Watched'),
          icon: ['fas', watched ? 'eye-slash' : 'eye'],
          run: () => setWatched(!watched)
        }
      }
      return { label: t('Video.Mark As Fully Watched'), icon: ['fas', 'flag-checkered'], run: () => setWatched(true, true) }
    case 'copyYoutube':
      return copyLinkItem.value
    case 'share':
      return shareLinkItem.value
    case 'download':
      return downloadItem.value
    default:
      return null
  }
}

const {
  enabled: thumbnailSwipeEnabled, swipe: thumbnailSwipe,
  startSwipe: startThumbnailSwipe, moveSwipe: moveThumbnailSwipe,
  finishSwipe: finishThumbnailSwipe, abortSwipe: abortThumbnailSwipe, cancelSwipe: cancelThumbnailSwipe,
} = useThumbnailSwipe({
  getAction: getThumbnailSwipeAction,
  cancelHold: cancelMenuHold,
  suppressClick: suppressMenuHoldClick,
  getSettleDuration: () => isReducedMotionEnabled() ? 0 : 200 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed),
  onCommit: action => {
    lightHaptic()
    action.run()
  },
})

watch([() => props.data.url, () => store.getters.getThumbnailLeftSwipeAction, () => store.getters.getThumbnailRightSwipeAction], cancelThumbnailSwipe)

const tileKeyboardShortcuts = inject(tileKeyboardShortcutsKey, false)

function handleTileKeydown(event) {
  if (handleMenuKeydown(event)) return
  if (tileKeyboardShortcuts && isTileMarkShortcut(event)) {
    // Like the menu, a new item is marked as seen first.
    event.preventDefault()
    if (showMarkAsSeen.value) {
      markAsSeen()
    } else if (!props.data.isLive) {
      setWatched(position.value?.watched !== true)
    }
  }
}
</script>

<style scoped lang="scss" src="./FtListFeedItem.scss" />
