<template>
  <FtAutoGrid
    :grid="displayValue !== 'list'"
    :thumbnail-size="thumbnailSize"
    aria-hidden="true"
    data-tab-loading-indicator
  >
    <div
      v-for="n in count"
      :key="n"
      class="skeletonCard"
      :class="{ listCard: displayValue === 'list' }"
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
  }
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const displayValue = computed(() => store.getters.getListType)

/** @type {import('vue').ComputedRef<number>} */
const thumbnailSize = computed(() => store.getters.getThumbnailSize)
</script>

<style scoped src="./FtSkeletonGrid.css" />
