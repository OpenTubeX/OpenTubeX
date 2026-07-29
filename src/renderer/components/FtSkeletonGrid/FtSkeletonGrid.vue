<template>
  <FtAutoGrid
    :grid="youtubeStyleShorts || displayValue !== 'list'"
    :thumbnail-size="thumbnailSize"
    :youtube-style-shorts="youtubeStyleShorts"
    aria-hidden="true"
    data-tab-loading-indicator
  >
    <div
      v-for="n in count"
      :key="n"
      class="skeletonCard"
      :class="{
        listCard: displayValue === 'list' && !youtubeStyleShorts,
        youtubeStyleShorts
      }"
    >
      <div class="skeletonThumbnail ft-shimmer" />
      <div class="skeletonDetails">
        <div class="skeletonLine ft-shimmer" />
        <div class="skeletonLine short ft-shimmer" />
      </div>
    </div>
  </FtAutoGrid>
</template>

<script setup>
import { computed } from 'vue'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'

import store from '../../store/index'

defineProps({
  count: {
    type: Number,
    default: 12
  },
  youtubeStyleShorts: {
    type: Boolean,
    default: false
  }
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const displayValue = computed(() => store.getters.getListType)

/** @type {import('vue').ComputedRef<number>} */
const thumbnailSize = computed(() => store.getters.getThumbnailSize)
</script>

<style scoped src="./FtSkeletonGrid.css" />
