<template>
  <TransitionGroup
    ref="gridElement"
    tag="div"
    name="feed"
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

const gridStyle = computed(() => {
  return getThumbnailSizeStyles(props.thumbnailSize, gridWidth.value)
})

let resizeObserver = null

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    gridWidth.value = entry.contentRect.width
  })

  resizeObserver.observe(gridElement.value.$el)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})
</script>

<style scoped src="./FtAutoGrid.css" />
