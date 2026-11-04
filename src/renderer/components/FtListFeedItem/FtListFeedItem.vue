<template>
  <div
    class="ft-list-video ft-list-item result"
    :class="{ grid: layout === 'grid', list: layout === 'list', watched: watchProgress?.watched }"
    @contextmenu="openContextMenu"
    @keydown="handleContextMenuKeydown"
    @pointerdown="startMenuHold"
    @pointermove="moveMenuHold"
    @pointerup="cancelMenuHold"
    @pointercancel="cancelMenuHold"
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
            :icon="['fas', 'rss']"
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
        :title="store.getters.getLimitTitlesToTwoLines ? data.title : null"
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
        <bdi class="channelName">
          <FtChannelAvatar
            v-if="avatar && !hideChannelAvatars"
            :thumbnail="avatar"
          />
          <span class="channelNameText">{{ data.author }}</span>
        </bdi>
        <FtInlineMetadata
          v-if="publishedText"
          class="videoInfo"
          icon-labels
        >
          <span class="uploadedTime"><FtIcon
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
import { copyToClipboard, getRelativeTimeFromDate, openInternalPath, showToast } from '../../helpers/utils'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'

const props = defineProps({
  /** @type {import('vue').PropType<import('../../helpers/rssFeeds').RssFeedItem>} */
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
  }
})

const { t } = useI18n()

const now = useRelativeTimeClock()
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)
const hideChannelAvatars = computed(() => store.getters.getHideChannelAvatars)
const thumbnailProgressRadius = computed(() => 8 * store.getters.getUiRoundness / 100)
// The external media page saves the position of everything it plays
const position = computed(() => getExternalMediaProgress(props.data.url))
const watchProgress = computed(() => position.value?.progress > 0 ? position.value : null)
const to = computed(() => ({ path: '/external-media', query: { url: props.data.url } }))
const publishedText = computed(() => props.data.published === null
  ? ''
  : getRelativeTimeFromDate(props.data.published, false, true, now.value))

const showNewIndicator = computed(() => store.getters.getShowNewSubscriptionFeedIndicators &&
  props.data.isNew === true && !props.inNewFeed && !position.value?.watched)
const showMarkAsSeen = computed(() => props.data.isNew === true && (props.inNewFeed || showNewIndicator.value))
// Like subscription videos, items that aren't new can come back to the New feed,
// and so can new items that it leaves out because they were watched
const showMarkAsUnseen = computed(() => !props.inNewFeed && (props.data.isNew !== true || position.value?.watched === true))

function markAsSeen() {
  if (props.data.isNew === true) markRssFeedItemsAsSeen([props.data])
}

function markAsUnseen() {
  // The New feed leaves out watched items
  if (position.value?.watched) {
    unmarkExternalMediaWatched(props.data.url)
    store.dispatch('scheduleSyncServer', 'history')
  }
  markRssFeedItemsAsUnseen([props.data])
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
  items.push({
    label: watched ? t('Video.Unmark As Watched') : t('Video.Mark As Watched'),
    icon: ['fas', watched ? 'eye-slash' : 'eye'],
    run: () => setWatched(!watched)
  })
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
const { startMenuHold, moveMenuHold, cancelMenuHold, suppressMenuHoldClick } = useContextMenuHold(openContextMenu)

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

function handleContextMenuKeydown(event) {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openContextMenu(event)
}

onBeforeUnmount(() => {
  window.dispatchEvent(new CustomEvent('opentubex:close-context-menu', { detail: menuItems }))
})
</script>

<style scoped lang="scss" src="./FtListFeedItem.scss" />
