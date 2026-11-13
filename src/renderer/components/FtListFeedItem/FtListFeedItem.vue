<template>
  <div
    class="ft-list-video ft-list-item result"
    :class="{ grid: layout === 'grid', list: layout === 'list', watched: watchProgress?.watched }"
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
          v-if="data.thumbnail"
          :src="data.thumbnail"
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
        v-if="watchProgress?.watched"
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
      :thumbnail="data.thumbnail"
      @close="showDownloadPrompt = false"
    />
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
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
import { useContextMenuHold } from '../../composables/useContextMenuHold'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { openButtonMenu } from '../../helpers/buttonMenu'
import {
  getExternalMediaProgress,
  markExternalMediaWatched,
  unmarkExternalMediaWatched
} from '../../helpers/externalMediaPosition'
import { lightHaptic } from '../../helpers/mobileHaptics'
import { markRssFeedItemsAsSeen, markRssFeedItemsAsUnseen } from '../../helpers/rssFeeds'
import { copyToClipboard, formatDurationAsTimestamp, formatViewCount, getRelativeTimeFromDate, openInternalPath, showToast } from '../../helpers/utils'
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
  }
})

const { t } = useI18n()

const now = useRelativeTimeClock()
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)
const hideChannelAvatars = computed(() => store.getters.getHideChannelAvatars)
const thumbnailProgressRadius = computed(() => 8 * store.getters.getUiRoundness / 100)
// The external media page saves the position of everything it plays. Live
// streams play from the channel's address, which every broadcast shares.
const position = computed(() => props.data.isLive ? null : getExternalMediaProgress(props.data.url))
const watchProgress = computed(() => position.value?.progress > 0 ? position.value : null)
const to = computed(() => ({ path: '/external-media', query: { url: props.data.url } }))
// Items from other platforms link to the page of their channel
const platform = computed(() => getPlatform(props.data.platform))
const platformIcon = computed(() => platform.value ? PLATFORM_ICONS[platform.value.id] : null)
const channelRoute = computed(() => platform.value && props.data.channelId
  ? getPlatformChannelRoute(platform.value.id, props.data.channelId)
  : null)
// Live streams show their viewers instead of their start
const publishedText = computed(() => props.data.published === null || props.data.isLive
  ? ''
  : getRelativeTimeFromDate(props.data.published, false, true, now.value))
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
  if (position.value?.watched) unmarkExternalMediaWatched(props.data.url)
  const markUnseen = props.seenMarks?.markUnseen ?? markRssFeedItemsAsUnseen
  markUnseen([props.data])
}

const showDownloadPrompt = ref(false)
const canDownload = computed(() => supportsYtDlp && store.getters.getEnableDownloads)
watch(canDownload, (enabled) => {
  if (!enabled) showDownloadPrompt.value = false
})

function setWatched(watched, fully = false) {
  if (watched) {
    markExternalMediaWatched(props.data.url, fully)
    markAsSeen()
  } else {
    unmarkExternalMediaWatched(props.data.url)
  }
  store.dispatch('scheduleSyncServer', 'history')
  showToast({
    message: watched ? t('Video.Video has been marked as watched') : t('Video.Video has been unmarked as watched'),
    image: props.data.thumbnail || null,
    icon: ['fas', watched ? 'eye' : 'eye-slash']
  })
}

function openElsewhere(newWindow) {
  openInternalPath({ ...to.value, title: props.data.title, doCreateNewTab: !newWindow, doCreateNewWindow: newWindow })
  markAsSeen()
}

const menuItems = computed(() => {
  const watched = position.value?.watched === true
  const items = []
  if (store.getters.getTabsEnabled) {
    items.push({
      label: t('Context Menu.Open in a New Tab'),
      shortLabel: t('New Tab'),
      icon: ['fas', 'arrow-up-right-from-square'],
      quickAction: true,
      run: () => openElsewhere(false)
    })
  }
  if (process.env.IS_ELECTRON) {
    items.push({
      label: t('Context Menu.Open in a New Window'),
      shortLabel: t('New Window'),
      icon: ['fas', 'external-link-alt'],
      quickAction: true,
      run: () => openElsewhere(true)
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
  if (position.value?.seconds > 0) {
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
  if (canDownload.value) {
    items.push({
      label: t('Downloads.Download Video'),
      icon: ['fas', 'download'],
      run: () => { showDownloadPrompt.value = true }
    })
  }
  items.push({ type: 'separator' }, {
    label: t('Share.Copy Link'),
    icon: ['fas', 'link'],
    run: () => copyToClipboard(props.data.url)
  })
  return items.map(item => item.type === 'separator' ? item : { enabled: true, ...item })
})

const menuButton = useTemplateRef('menuButton')
const openMobileContextActions = inject('openMobileContextActions')
const { startMenuHold, moveMenuHold, cancelMenuHold, handleMenuHoldDragStart, suppressMenuHoldClick } = useContextMenuHold(openContextMenu)

function openOptionsMenu() {
  cancelMenuHold()
  openButtonMenu(menuButton.value.$el.querySelector('button'), menuItems, props.data.title)
}

function openContextMenu(event) {
  if (event.target.closest('[role="dialog"], [role="menu"]')) return
  if (event.pointerType !== 'touch' && !process.env.IS_ELECTRON) {
    // Only Electron can merge native image and selection actions into our menu.
    const selection = window.getSelection()
    if (event.target.closest('img, video') || (selection && !selection.isCollapsed && selection.containsNode(event.target, true))) return
  }
  event.preventDefault()
  event.stopPropagation()
  cancelMenuHold()
  if (event.pointerType === 'touch') {
    suppressMenuHoldClick()
    openMobileContextActions({ title: props.data.title, actions: menuItems })
    lightHaptic()
    return
  }
  const bounds = event.target.getBoundingClientRect()
  const keyboard = event.type === 'keydown' || (event.clientX === 0 && event.clientY === 0)
  window.dispatchEvent(new CustomEvent('opentubex:context-menu', {
    detail: { x: keyboard ? bounds.left : event.clientX, y: keyboard ? bounds.bottom : event.clientY, items: menuItems, contextEvent: event }
  }))
}

const tileKeyboardShortcuts = inject(tileKeyboardShortcutsKey, false)

function handleTileKeydown(event) {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    openContextMenu(event)
  } else if (tileKeyboardShortcuts && isTileMarkShortcut(event)) {
    // Like the menu, a new item is marked as seen first.
    event.preventDefault()
    if (showMarkAsSeen.value) {
      markAsSeen()
    } else if (!props.data.isLive) {
      setWatched(position.value?.watched !== true)
    }
  }
}

onBeforeUnmount(() => {
  window.dispatchEvent(new CustomEvent('opentubex:close-context-menu', { detail: menuItems }))
})
</script>

<style scoped lang="scss" src="./FtListFeedItem.scss" />
