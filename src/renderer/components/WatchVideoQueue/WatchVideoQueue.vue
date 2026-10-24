<template>
  <FtCard
    class="watchQueue"
    :class="{ fullscreenQueue: fullscreenOverlay }"
  >
    <Teleport
      :to="phonePanelHeader || 'body'"
      :disabled="!phonePanelHeader"
    >
      <header
        ref="queueHeader"
        class="queueHeader"
        :class="{ fullscreenDockHeader: fullscreenOverlay }"
      >
        <div class="queueHeading">
          <h3 class="queueTitle">
            <FtIcon
              v-if="fullscreenOverlay"
              class="queueTitleIcon"
              :icon="['fas', 'queue']"
              aria-hidden="true"
            />
            <span
              ref="queueLabel"
              class="queueLabel"
            >{{ t('Video.Queue') }}</span>
          </h3>
          <span class="queueCount">
            {{ t('Video.Queue Video Count', { count: items.length }, items.length) }}
          </span>
        </div>
        <button
          v-if="showSaveQueue"
          type="button"
          class="queueHeaderAction saveQueue"
          :aria-label="t('Video.Save Queue to Playlist')"
          :title="t('Video.Save Queue to Playlist')"
          @click="saveToPlaylist"
        >
          <FtIcon
            :icon="['fas', 'playlist-add']"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="queueHeaderAction clearQueue"
          :aria-label="t('Video.Clear Queue')"
          :title="t('Video.Clear Queue')"
          @click="clearQueue"
        >
          <FtIcon
            class="clearQueueIcon"
            :icon="['fas', 'trash']"
            aria-hidden="true"
          />
          <span class="clearQueueLabel">{{ t('Video.Clear Queue') }}</span>
        </button>
        <button
          v-if="fullscreenOverlay"
          type="button"
          class="fullscreenDockClose"
          :aria-label="t('Close')"
          :title="t('Close')"
          @click="emit('close')"
        >
          <FtIcon :icon="['fas', 'xmark']" />
        </button>
      </header>
    </Teleport>

    <p
      :id="reorderInstructionsId"
      class="queueReorderInstructions"
    >
      {{ t('Video.Reorder Queue Item Instructions') }}
    </p>
    <div
      ref="queueItems"
      v-overlay-scrollbars
      class="queueItems"
    >
      <TransitionGroup
        ref="queueContent"
        name="queueItem"
        tag="ol"
        class="queueItemsContent"
        :data-skip-move="draggedItemId !== null ? '' : null"
      >
        <li
          v-for="(item, index) in items"
          :key="item.queueItemId"
          class="queueItem"
          :data-queue-item-id="String(item.queueItemId)"
          :class="{ dragging: draggedItemId === String(item.queueItemId) }"
          :style="rowStyle(String(item.queueItemId))"
          :aria-posinset="index + 1"
          :aria-setsize="items.length"
        >
          <button
            :ref="element => setQueueDragHandle(item.queueItemId, element)"
            type="button"
            class="queueDragHandle"
            :aria-label="t('Video.Reorder Queue Item', { title: item.title })"
            :aria-describedby="reorderInstructionsId"
            aria-keyshortcuts="ArrowUp ArrowDown"
            :title="t('Video.Drag to Reorder Queue', { title: item.title })"
            @dragstart.prevent
            @pointerdown="startPointerDrag($event, String(item.queueItemId))"
            @pointermove="movePointerDrag"
            @pointerup="endPointerDrag"
            @pointercancel="cancelPointerDrag"
            @lostpointercapture="cancelPointerDrag"
            @keydown.up.prevent="moveWithKeyboard(item.queueItemId, -1)"
            @keydown.down.prevent="moveWithKeyboard(item.queueItemId, 1)"
          >
            <FtIcon :icon="['fas', 'bars']" />
          </button>
          <FtListVideo
            v-if="isYoutubeVideo(item)"
            class="queueVideo"
            :data="listVideoData(item)"
            appearance="watchPlaylistItem"
            force-list-type="list"
            @open-video="playQueuedVideo(item.queueItemId)"
            @pause-player="emit('pause-player')"
          />
          <!-- Other downloaded media has no YouTube metadata or actions -->
          <RouterLink
            v-else
            class="queueVideo externalQueueVideo"
            :to="item.route ?? `/watch/${item.videoId}`"
            @click="playExternalQueuedVideo(item.queueItemId, $event)"
          >
            <FtRetryImage
              class="queueThumbnail"
              :src="item.thumbnail"
              alt=""
            />
            <span class="queueDetails">
              <h3
                class="queueVideoTitle"
                dir="auto"
              >{{ item.title }}</h3>
              <span
                class="queueAuthor"
                dir="auto"
              >{{ item.author }}</span>
            </span>
          </RouterLink>
          <FtIconButton
            :ref="element => setQueueItemMenuButton(item.queueItemId, element)"
            class="queueItemMenu"
            :title="t('Video.More Options')"
            theme="base-no-default"
            :size="18"
            :padding="queueItemMenuPadding"
            :use-shadow="false"
            @click="openQueueItemMenu(item.queueItemId)"
          />
        </li>
      </TransitionGroup>
    </div>
    <p
      class="queueReorderStatus"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ queueReorderStatus }}
    </p>
  </FtCard>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { inject, computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOrderedItemReorder } from '../../composables/useOrderedItemReorder'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { useScrollClamp } from '../../composables/useScrollClamp'
import FtCard from '../ft-card/ft-card.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtListVideo from '../FtListVideo/FtListVideo.vue'
import FtRetryImage from '../FtRetryImage.vue'
import store from '../../store/index'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { openButtonMenu } from '../../helpers/buttonMenu'

const phonePanelHeader = inject('phonePanelHeader', null)
const props = defineProps({ fullscreenOverlay: { type: Boolean, default: false } })
const emit = defineEmits(['pause-player', 'close'])
const { t, locale } = useI18n()

const items = computed(() => store.getters.getWatchQueue)
const queueItems = useTemplateRef('queueItems')
const queueContent = useTemplateRef('queueContent')
const contentElement = computed(() => queueContent.value?.$el ?? null)
const clampScroll = useScrollClamp(queueItems, contentElement)
const reorderInstructionsId = useId()
const queueReorderStatus = ref('')
const queueDragHandles = new Map()
let queueAnnouncementSequence = 0

function getScrollTop() {
  return queueItems.value?.scrollTop ?? 0
}

function restoreScrollTop(position) {
  if (!queueItems.value) return
  restoreOverlayScrollTop(queueItems.value, position)
  clampScroll()
}

defineExpose({ getScrollTop, restoreScrollTop })

// Saved changes return as a new array; only a different order may cancel a drag.
const queueItemIds = computed(previous => {
  const ids = items.value.map(item => String(item.queueItemId))
  return previous?.length === ids.length && previous.every((id, index) => id === ids[index]) ? previous : ids
})
// Suppress TransitionGroup moves while the drag owns the row transforms.
const {
  draggedItemId, rowStyle,
  startPointerDrag, movePointerDrag, endPointerDrag, cancelPointerDrag,
} = useOrderedItemReorder({
  items: queueItemIds,
  rowSelector: '.queueItem',
  itemIdAttribute: 'data-queue-item-id',
  // A drag moves one video: the one whose removal leaves both orders equal.
  async updateItems(order) {
    const current = queueItemIds.value
    const index = order.findIndex((id, position) => id !== current[position])
    if (index === -1) return false
    const without = (ids, id) => ids.filter(other => other !== id)
    const unchangedWithout = id => {
      const remaining = without(current, id)
      return without(order, id).every((other, position) => other === remaining[position])
    }
    const id = unchangedWithout(order[index]) ? order[index] : current[index]
    const position = order.indexOf(id)
    const after = position > current.indexOf(id)
    const queueItemId = id => items.value.find(item => String(item.queueItemId) === id).queueItemId
    store.commit('moveVideoInWatchQueue', {
      queueItemId: queueItemId(id),
      targetQueueItemId: queueItemId(order[position + (after ? -1 : 1)]),
      after
    })
    return true
  },
  announceMoved(id, position) {
    const item = items.value.find(item => String(item.queueItemId) === id)
    if (item) {
      announceQueueReorder(t('Video.Queue Item Moved', {
        title: item.title, position: position + 1, total: items.value.length
      }))
    }
  }
})

function isYoutubeVideo(item) {
  return /^[\w-]{11}$/.test(item.videoId)
}

// Downloads have no duration, which list items would otherwise show as live.
function listVideoData(item) {
  return item.route && item.lengthSeconds === undefined ? { ...item, lengthSeconds: '' } : item
}

function playQueuedVideo(queueItemId) {
  emit('pause-player')
  remove(queueItemId)
}

function playExternalQueuedVideo(queueItemId, event) {
  if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    playQueuedVideo(queueItemId)
  }
}

// Touch layouts get a full-size target, matching the drag handle.
const touchLayout = usePhoneLayout('(width <= 600px), (pointer: coarse)')
const queueItemMenuPadding = computed(() => touchLayout.value ? 15 : 6)

const queueItemMenuButtons = new Map()
const openMenuQueueItemId = ref(null)
const queueItemMenuItems = computed(() => {
  const index = items.value.findIndex(item => item.queueItemId === openMenuQueueItemId.value)
  if (index === -1) return []
  const queueItemId = openMenuQueueItemId.value
  return [
    { label: t('User Playlists.Move Video Up'), icon: ['fas', 'arrow-up'], enabled: index > 0, run: () => moveWithKeyboard(queueItemId, -1) },
    { label: t('User Playlists.Move Video Down'), icon: ['fas', 'arrow-down'], enabled: index < items.value.length - 1, run: () => moveWithKeyboard(queueItemId, 1) },
    { label: t('Video.Remove Video from Queue'), icon: ['fas', 'trash'], enabled: true, run: () => remove(queueItemId) },
  ]
})

function setQueueItemMenuButton(queueItemId, component) {
  if (component) {
    queueItemMenuButtons.set(queueItemId, component)
  } else {
    queueItemMenuButtons.delete(queueItemId)
  }
}

function openQueueItemMenu(queueItemId) {
  openMenuQueueItemId.value = queueItemId
  openButtonMenu(queueItemMenuButtons.get(queueItemId).$el.querySelector('button'), queueItemMenuItems)
}

function closeQueueItemMenu() {
  window.dispatchEvent(new CustomEvent('opentubex:close-context-menu', { detail: queueItemMenuItems }))
}
// Close the menu if another window removed its video.
watch(() => queueItemMenuItems.value.length === 0, removed => { if (removed) closeQueueItemMenu() })
onBeforeUnmount(closeQueueItemMenu)

function move(queueItemId, offset) {
  const index = items.value.findIndex(item => item.queueItemId === queueItemId)
  const target = items.value[index + offset]
  if (index === -1 || !target) return
  store.commit('moveVideoInWatchQueue', {
    queueItemId,
    targetQueueItemId: target.queueItemId,
    after: offset > 0
  })
}

function setQueueDragHandle(queueItemId, element) {
  if (element) {
    queueDragHandles.set(queueItemId, element)
  } else {
    queueDragHandles.delete(queueItemId)
  }
}

async function announceQueueReorder(message) {
  const sequence = ++queueAnnouncementSequence
  queueReorderStatus.value = ''
  await nextTick()

  if (sequence === queueAnnouncementSequence) {
    queueReorderStatus.value = message
  }
}

async function moveWithKeyboard(queueItemId, offset) {
  const currentIndex = items.value.findIndex(item => item.queueItemId === queueItemId)
  if (currentIndex === -1) {
    return
  }

  const item = items.value[currentIndex]
  const total = items.value.length
  const targetIndex = currentIndex + offset
  if (targetIndex < 0 || targetIndex >= total) {
    const message = offset < 0
      ? t('Video.Queue Item Cannot Move Up', { title: item.title, total })
      : t('Video.Queue Item Cannot Move Down', { title: item.title, total })
    await announceQueueReorder(message)
    return
  }

  move(queueItemId, offset)
  await nextTick()
  queueDragHandles.get(queueItemId)?.focus({ preventScroll: true })
  await announceQueueReorder(t('Video.Queue Item Moved', {
    title: item.title,
    position: targetIndex + 1,
    total
  }))
}

function remove(queueItemId) {
  store.commit('removeVideoFromWatchQueue', queueItemId)
}

function clearQueue() {
  store.commit('clearWatchQueue')
}

const showPlaylists = computed(() => !store.getters.getHidePlaylists)
// Local playlists only hold YouTube videos, so other downloaded media stays queued only.
const playlistVideos = computed(() => items.value
  .filter(isYoutubeVideo)
  .map(item => ({
    videoId: item.videoId,
    title: item.title,
    author: item.author,
    authorId: item.authorId,
    lengthSeconds: item.lengthSeconds ?? '',
    published: item.published,
    premiereDate: item.premiereDate,
    premiereTimestamp: item.premiereTimestamp,
    isMembersOnly: item.isMembersOnly,
  })))

function saveToPlaylist() {
  store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: playlistVideos.value })
}

const showSaveQueue = computed(() => showPlaylists.value && playlistVideos.value.length > 0)

const queueHeader = useTemplateRef('queueHeader')
const queueLabel = useTemplateRef('queueLabel')

// Keep the fullscreen dock header in one row like the other docks: hide the
// clear label, then the count, before the title has to truncate.
function fitHeader() {
  const header = queueHeader.value
  const label = queueLabel.value
  if (!header || !label) return
  if (!props.fullscreenOverlay) {
    delete header.dataset.compact
    return
  }
  // Compare unrounded widths, as a fractional overflow already shows an
  // ellipsis. The tolerance only absorbs float noise from zoom and transforms;
  // a real overflow is at least one layout unit (1/64 device pixel).
  const text = document.createRange()
  text.selectNodeContents(label)
  let titleWidth = -1
  for (let level = 0; level <= 2; level++) {
    header.dataset.compact = String(level)
    const width = label.getBoundingClientRect().width
    if (text.getBoundingClientRect().width - width < 0.001) return
    // A count below the title, as in portrait sheets, takes no room from it.
    if (level === 2 && width - titleWidth < 0.001) header.dataset.compact = '1'
    titleWidth = width
  }
}

// Only the header is observed, as fitting it never changes its own size.
const headerResizeObserver = new ResizeObserver(fitHeader)
watch(queueHeader, (header, previous) => {
  if (previous) headerResizeObserver.unobserve(previous)
  if (header) headerResizeObserver.observe(header)
})
watch([
  () => props.fullscreenOverlay, () => items.value.length, showSaveQueue, locale, () => store.getters.getAppFont
], fitHeader, { flush: 'post' })
// A web font that finishes loading changes the title width, not the header's.
document.fonts.addEventListener('loadingdone', fitHeader)
onBeforeUnmount(() => {
  headerResizeObserver.disconnect()
  document.fonts.removeEventListener('loadingdone', fitHeader)
})
</script>

<style scoped src="./WatchVideoQueue.scss" lang="scss" />
