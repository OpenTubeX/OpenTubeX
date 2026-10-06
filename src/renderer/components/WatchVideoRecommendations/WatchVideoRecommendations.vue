<template>
  <FtCard
    v-if="visibleData.length > 0"
    class="relative watchVideoRecommendations"
    :class="{ fullscreenRecommendations: fullscreenOverlay }"
  >
    <header
      class="VideoRecommendationsTopBar recommendationsDockHeader"
      :class="{ fullscreenDockHeader: fullscreenOverlay }"
    >
      <h3>
        <FtIcon
          v-if="fullscreenOverlay"
          :icon="['fas', 'play-circle']"
          aria-hidden="true"
        />
        {{ offline ? $t("Downloads.Available Offline") : $t("Up Next") }}
      </h3>
      <button
        v-if="fullscreenOverlay"
        type="button"
        class="fullscreenDockClose"
        :aria-label="$t('Close')"
        :title="$t('Close')"
        @click="emit('close')"
      >
        <FtIcon :icon="['fas', 'xmark']" />
      </button>
    </header>
    <div
      ref="scroller"
      v-overlay-scrollbars="fullscreenOverlay"
      class="recommendationsScroller"
    >
      <div
        ref="content"
        class="recommendationsContent"
      >
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
      </div>
    </div>
  </FtCard>
</template>

<script setup>

import { computed, useTemplateRef } from 'vue'
import { FtIcon } from '@opentubex/icons'
import { useScrollClamp } from '../../composables/useScrollClamp'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import FtCard from '../ft-card/ft-card.vue'
import FtListVideoLazy from '../FtListVideoLazy.vue'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import store from '../../store'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  fullscreenOverlay: { type: Boolean, default: false },
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
      hiddenChannelNames: store.getters.getActiveChannelsHiddenNames,
      forbiddenTitles: store.getters.getActiveForbiddenTitles,
      hideChannelsBasedOnText: false,
    })))

const emit = defineEmits(['pause-player', 'close'])
const scroller = useTemplateRef('scroller')
const content = useTemplateRef('content')
const clampScroll = useScrollClamp(scroller, content)

function getScrollTop() {
  return scroller.value?.scrollTop ?? 0
}

function restoreScrollTop(position) {
  if (!props.fullscreenOverlay || !scroller.value) return
  restoreOverlayScrollTop(scroller.value, position)
  clampScroll()
}

defineExpose({ getScrollTop, restoreScrollTop })

function pausePlayer() {
  emit('pause-player')
}
</script>

<style scoped src="./WatchVideoRecommendations.css" />
