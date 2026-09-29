<template>
  <FtCard
    v-if="visibleData.length > 0"
    class="relative watchVideoRecommendations"
  >
    <div class="VideoRecommendationsTopBar">
      <h3>
        {{ offline ? $t("Downloads.Available Offline") : $t("Up Next") }}
      </h3>
    </div>
    <template v-if="offline">
      <router-link
        v-for="video in visibleData"
        :key="video.videoId"
        :to="video.route"
        class="offlineDownloadRecommendation"
        @click="pausePlayer"
      >
        <img
          :src="thumbnailPlaceholder"
          alt=""
          class="offlineDownloadThumbnail"
        >
        <span class="offlineDownloadText">
          <span class="offlineDownloadTitle">{{ video.title }}</span>
          <span
            v-if="video.author"
            class="offlineDownloadAuthor"
          >{{ video.author }}</span>
        </span>
      </router-link>
    </template>
    <!-- Match the five loading rows so the card is populated when the skeleton disappears. -->
    <template v-else>
      <FtListVideoLazy
        v-for="(video, index) in visibleData"
        :key="video.videoId"
        :data="video"
        appearance="recommendation"
        force-list-type="list"
        :initial-visible-state="index < 5"
        :use-channels-hidden-preference="true"
        @pause-player="pausePlayer"
      />
    </template>
  </FtCard>
</template>

<script setup>

import { computed } from 'vue'
import FtCard from '../ft-card/ft-card.vue'
import FtListVideoLazy from '../FtListVideoLazy.vue'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import store from '../../store'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  data: {
    type: Array,
    required: true
  },
  offline: {
    type: Boolean,
    default: false
  }
})

const visibleData = computed(() => props.offline
  ? props.data
  : props.data.filter(video => !isVideoHiddenByPreferences(video, {
      hiddenChannelNames: store.getters.getChannelsHiddenNames,
      forbiddenTitles: store.getters.getForbiddenTitlesParsed,
      hideChannelsBasedOnText: false,
    })))

const emit = defineEmits(['pause-player'])

function pausePlayer() {
  emit('pause-player')
}
</script>

<style scoped src="./WatchVideoRecommendations.css" />
