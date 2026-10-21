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
      >
        <li
          v-for="(item, index) in items"
          :key="item.queueItemId"
          class="queueItem"
          :data-queue-item-id="String(item.queueItemId)"
          :class="{
            dragging: draggedQueueItemId === item.queueItemId || pointerDraggedId === String(item.queueItemId),
            dropBefore: dropTarget?.id === String(item.queueItemId) && !dropTarget.after,
            dropAfter: dropTarget?.id === String(item.queueItemId) && dropTarget.after
          }"
          :aria-posinset="index + 1"
          :aria-setsize="items.length"
          @dragover.prevent
          @drop.prevent="dropDraggedItem(item.queueItemId)"
        >
          <button
            :ref="element => setQueueDragHandle(item.queueItemId, element)"
            type="button"
            class="queueDragHandle"
            draggable="true"
            :aria-label="t('Video.Reorder Queue Item', { title: item.title })"
            :aria-describedby="reorderInstructionsId"
            aria-keyshortcuts="ArrowUp ArrowDown"
            :title="t('Video.Drag to Reorder Queue', { title: item.title })"
            @dragstart="startDrag($event, item.queueItemId)"
            @dragend="endDrag"
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
          <RouterLink
            class="queueVideo"
            :to="item.route ?? `/watch/${item.videoId}`"
            @click="playQueuedVideo(item.queueItemId, $event)"
          >
            <FtRetryImage
              class="queueThumbnail"
              :src="item.thumbnail || thumbnailUrl(item.videoId)"
              alt=""
            />
            <span class="queueDetails">
              <strong
                class="queueVideoTitle"
                dir="auto"
              >{{ item.title }}</strong>
              <span
                class="queueAuthor"
                dir="auto"
              >{{ item.author }}</span>
            </span>
          </RouterLink>
          <div class="queueActions">
            <button
              type="button"
              class="queueMoveButton"
              :aria-label="t('Video.Move Queue Item Up', { title: item.title })"
              :disabled="index === 0"
              @click="moveWithKeyboard(item.queueItemId, -1)"
            >
              <FtIcon
                :icon="['fas', 'arrow-up']"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="queueMoveButton"
              :aria-label="t('Video.Move Queue Item Down', { title: item.title })"
              :disabled="index === items.length - 1"
              @click="moveWithKeyboard(item.queueItemId, 1)"
            >
              <FtIcon
                :icon="['fas', 'arrow-down']"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              :aria-label="t('Video.Remove from Queue', { title: item.title })"
              :title="t('Video.Remove from Queue', { title: item.title })"
              @click="remove(item.queueItemId)"
            >
              <FtIcon :icon="['fas', 'trash']" />
            </button>
          </div>
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

import { useOrderedItemDrag } from '../../composables/useOrderedItemDrag'
import { useScrollClamp } from '../../composables/useScrollClamp'
import FtCard from '../ft-card/ft-card.vue'
import FtRetryImage from '../FtRetryImage.vue'
import { getVideoThumbnailUrl } from '../../helpers/utils'
import store from '../../store/index'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

const phonePanelHeader = inject('phonePanelHeader', null)
const props = defineProps({ fullscreenOverlay: { type: Boolean, default: false } })
const emit = defineEmits(['pause-player', 'close'])
const { t, locale } = useI18n()

const items = computed(() => store.getters.getWatchQueue)
const backendPreference = computed(() => store.getters.getBackendPreference)
const invidiousUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)
const draggedQueueItemId = ref(null)
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

const {
  draggedItemId: pointerDraggedId, dropTarget,
  startPointerDrag, movePointerDrag, endPointerDrag, cancelPointerDrag,
} = useOrderedItemDrag({
  items: computed(() => items.value.map(item => String(item.queueItemId))),
  rowSelector: '.queueItem',
  itemIdAttribute: 'data-queue-item-id',
  updateItems(order) {
    const from = items.value.findIndex(item => String(item.queueItemId) === pointerDraggedId.value)
    if (from === -1) return
    const id = items.value[from].queueItemId
    move(id, order.indexOf(String(id)) - from)
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

function thumbnailUrl(videoId) {
  return getVideoThumbnailUrl(videoId, backendPreference.value, invidiousUrl.value)
}

function playQueuedVideo(queueItemId, event) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }

  emit('pause-player')
  remove(queueItemId)
}

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

function startDrag(event, queueItemId) {
  draggedQueueItemId.value = queueItemId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(queueItemId))

  const queueItem = event.currentTarget.closest('.queueItem')
  if (queueItem) {
    event.dataTransfer.setDragImage(queueItem, 12, 12)
  }
}

function moveDraggedItem(queueItemId) {
  const draggedItemId = draggedQueueItemId.value
  if (draggedItemId == null || draggedItemId === queueItemId) {
    return
  }

  const draggedIndex = items.value.findIndex(item => item.queueItemId === draggedItemId)
  const targetIndex = items.value.findIndex(item => item.queueItemId === queueItemId)
  if (draggedIndex === -1 || targetIndex === -1) {
    return
  }

  move(draggedItemId, targetIndex - draggedIndex)
}

function dropDraggedItem(queueItemId) {
  moveDraggedItem(queueItemId)
  endDrag()
}

function endDrag() {
  draggedQueueItemId.value = null
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
  .filter(item => /^[\w-]{11}$/.test(item.videoId))
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
watch([() => props.fullscreenOverlay, () => items.value.length, showSaveQueue, locale], fitHeader, { flush: 'post' })
onBeforeUnmount(() => headerResizeObserver.disconnect())
</script>

<style scoped src="./WatchVideoQueue.scss" lang="scss" />
