<template>
  <FtCard class="watchQueue">
    <header class="queueHeader">
      <div>
        <h3 class="queueTitle">
          {{ t('Video.Queue') }}
        </h3>
        <span class="queueCount">
          {{ t('Video.Queue Video Count', { count: items.length }, items.length) }}
        </span>
      </div>
      <button
        type="button"
        class="clearQueue"
        :aria-label="t('Video.Clear Queue')"
        :title="t('Video.Clear Queue')"
        @click="clearQueue"
      >
        {{ t('Video.Clear Queue') }}
      </button>
    </header>
    <TransitionGroup
      v-overlay-scrollbars
      name="queueItem"
      tag="ol"
      class="queueItems"
    >
      <li
        v-for="item in items"
        :key="item.queueItemId"
        class="queueItem"
        :class="{ dragging: draggedQueueItemId === item.queueItemId }"
        @dragover.prevent
        @drop.prevent="dropDraggedItem(item.queueItemId)"
      >
        <span
          class="queueDragHandle"
          draggable="true"
          tabindex="0"
          :aria-label="t('Video.Drag to Reorder Queue', { title: item.title })"
          :title="t('Video.Drag to Reorder Queue', { title: item.title })"
          @dragstart="startDrag($event, item.queueItemId)"
          @dragend="endDrag"
          @keydown.up.prevent="move(item.queueItemId, -1)"
          @keydown.down.prevent="move(item.queueItemId, 1)"
        >
          <FontAwesomeIcon :icon="['fas', 'bars']" />
        </span>
        <RouterLink
          class="queueVideo"
          :to="`/watch/${item.videoId}`"
          @click="playQueuedVideo(item.queueItemId, $event)"
        >
          <img
            class="queueThumbnail"
            :src="thumbnailUrl(item.videoId)"
            alt=""
          >
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
            :aria-label="t('Video.Remove from Queue', { title: item.title })"
            :title="t('Video.Remove from Queue', { title: item.title })"
            @click="remove(item.queueItemId)"
          >
            <FontAwesomeIcon :icon="['fas', 'trash']" />
          </button>
        </div>
      </li>
    </TransitionGroup>
  </FtCard>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import store from '../../store/index'

const emit = defineEmits(['pause-player'])
const { t } = useI18n()

const items = computed(() => store.getters.getWatchQueue)
const backendPreference = computed(() => store.getters.getBackendPreference)
const invidiousUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)
const draggedQueueItemId = ref(null)

function thumbnailUrl(videoId) {
  const baseUrl = backendPreference.value === 'invidious' ? invidiousUrl.value : 'https://i.ytimg.com'
  return `${baseUrl}/vi/${videoId}/mqdefault.jpg`
}

function playQueuedVideo(queueItemId, event) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }

  emit('pause-player')
  remove(queueItemId)
}

function move(queueItemId, offset) {
  store.commit('moveVideoInWatchQueue', { queueItemId, offset })
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
</script>

<style scoped src="./WatchVideoQueue.scss" lang="scss" />
