<template>
  <TransitionGroup
    ref="gridElement"
    tag="div"
    name="feed"
    :move-class="suppressMoveTransition ? 'feed-move-suppressed' : undefined"
    :class="{
      grid: grid,
      list: !grid,
      thumbnailSizeReady: grid && gridWidth > 0
    }"
    :style="gridStyle"
  >
    <slot />
  </TransitionGroup>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

import { DEFAULT_THUMBNAIL_SIZE, getThumbnailSizeStyles } from '../../constants/thumbnailSize'

const props = defineProps({
  grid: {
    type: Boolean,
    required: true
  },
  thumbnailSize: {
    type: Number,
    default: DEFAULT_THUMBNAIL_SIZE
  }
})

const gridElement = useTemplateRef('gridElement')
const gridWidth = ref(0)

// While the container itself is resizing (window resize, or a modal's
// scrollbar compensation nudging the layout by a fraction of a pixel at
// fractional display scales), the FLIP move transition must not run —
// it should only animate actual list changes. 'feed-move-suppressed' has
// no transition, so the TransitionGroup skips the move handling entirely.
const suppressMoveTransition = ref(false)
let suppressResetTimeout = null

const gridStyle = computed(() => {
  return getThumbnailSizeStyles(props.thumbnailSize, gridWidth.value)
})

let resizeObserver = null

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (gridWidth.value !== 0 && entry.contentRect.width !== gridWidth.value) {
      suppressMoveTransition.value = true
      clearTimeout(suppressResetTimeout)
      suppressResetTimeout = setTimeout(() => {
        suppressMoveTransition.value = false
      }, 100)
    }

    gridWidth.value = entry.contentRect.width
  })

  resizeObserver.observe(gridElement.value.$el)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  clearTimeout(suppressResetTimeout)
})
</script>

<style scoped src="./FtAutoGrid.css" />
