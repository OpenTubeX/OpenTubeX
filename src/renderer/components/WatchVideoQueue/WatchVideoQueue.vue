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
    <ol class="queueItems">
      <li
        v-for="(item, index) in items"
        :key="item.queueItemId"
        class="queueItem"
      >
        <RouterLink
          class="queueVideo"
          :to="`/watch/${item.videoId}`"
          @click="playQueuedVideo(item.queueItemId)"
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
            :disabled="index === 0"
            :aria-label="t('Video.Move Up in Queue', { title: item.title })"
            :title="t('Video.Move Up in Queue', { title: item.title })"
            @click="move(item.queueItemId, -1)"
          >
            <FontAwesomeIcon :icon="['fas', 'arrow-up']" />
          </button>
          <button
            type="button"
            :disabled="index === items.length - 1"
            :aria-label="t('Video.Move Down in Queue', { title: item.title })"
            :title="t('Video.Move Down in Queue', { title: item.title })"
            @click="move(item.queueItemId, 1)"
          >
            <FontAwesomeIcon :icon="['fas', 'arrow-down']" />
          </button>
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
    </ol>
  </FtCard>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import store from '../../store/index'

const emit = defineEmits(['pause-player'])
const { t } = useI18n()

const items = computed(() => store.getters.getWatchQueue)
const backendPreference = computed(() => store.getters.getBackendPreference)
const invidiousUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

function thumbnailUrl(videoId) {
  const baseUrl = backendPreference.value === 'invidious' ? invidiousUrl.value : 'https://i.ytimg.com'
  return `${baseUrl}/vi/${videoId}/mqdefault.jpg`
}

function playQueuedVideo(queueItemId) {
  emit('pause-player')
  remove(queueItemId)
}

function move(queueItemId, offset) {
  store.commit('moveVideoInWatchQueue', { queueItemId, offset })
}

function remove(queueItemId) {
  store.commit('removeVideoFromWatchQueue', queueItemId)
}

function clearQueue() {
  store.commit('clearWatchQueue')
}
</script>

<style scoped src="./WatchVideoQueue.scss" lang="scss" />
