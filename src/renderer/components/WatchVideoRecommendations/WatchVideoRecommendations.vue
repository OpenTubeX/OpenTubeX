<template>
  <FtCard
    class="relative watchVideoRecommendations"
  >
    <div class="VideoRecommendationsTopBar">
      <h3>
        {{ $t("Up Next") }}
      </h3>
    </div>
    <!-- Match the five loading rows so the card is populated when the skeleton disappears. -->
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
  </FtCard>
</template>

<script setup>

import { computed } from 'vue'
import FtCard from '../ft-card/ft-card.vue'
import FtListVideoLazy from '../FtListVideoLazy.vue'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import store from '../../store'

const props = defineProps({
  data: {
    type: Array,
    required: true
  }
})

const visibleData = computed(() => props.data.filter(video => !isVideoHiddenByPreferences(video, {
  hiddenChannelNames: store.getters.getChannelsHiddenNames,
  forbiddenTitles: store.getters.getForbiddenTitlesParsed,
  hideChannelsBasedOnText: store.getters.getHideChannelsBasedOnText,
})))

const emit = defineEmits(['pause-player'])

function pausePlayer() {
  emit('pause-player')
}
</script>

<style scoped src="./WatchVideoRecommendations.css" />
