<template>
  <TransitionGroup
    ref="gridElement"
    tag="div"
    name="feed"
    :appear="appear"
    :move-class="moveClass"
    :class="{
      autoGrid: true,
      grid: grid,
      list: !grid,
      thumbnailSizeReady: grid && gridWidth > 0,
      youtubeStyleShorts
    }"
    :style="gridStyle"
    @before-leave="captureLeavingItemLayout"
  >
    <slot />
  </TransitionGroup>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

import { DEFAULT_THUMBNAIL_SIZE, getThumbnailSizeStyles } from '../../constants/thumbnailSize'
import { measureStableGridWidth } from './gridWidth'

const props = defineProps({
  appear: {
    type: Boolean,
    default: false
  },
  grid: {
    type: Boolean,
    required: true
  },
  thumbnailSize: {
    type: Number,
    default: DEFAULT_THUMBNAIL_SIZE
  },
  itemCount: {
    type: Number,
    default: 0
  },
  youtubeStyleShorts: {
    type: Boolean,
    default: false
  }
})

// Above this many items the move transition costs more than it conveys. Vue's
// FLIP measures and then writes a transform per child in one loop, so every
// item forces its own layout pass; on a feed of hundreds of cards that stalls
// the very interaction (pagination, filtering) it is meant to smooth over.
const MOVE_TRANSITION_MAX_ITEMS = 50

const gridElement = useTemplateRef('gridElement')
const gridWidth = ref(0)

// While the container itself is being sized or resized (initial layout,
// window resize, or a modal's
// scrollbar compensation nudging the layout by a fraction of a pixel at
// fractional display scales), the FLIP move transition must not run —
// it should only animate actual list changes. 'feed-move-suppressed' has
// no transition, so the TransitionGroup skips the move handling entirely.
const suppressMoveTransition = ref(false)
let suppressResetTimeout = null

const prefersReducedMotion = ref(false)
/** @type {MediaQueryList | null} */
let reducedMotionQuery = null

function handleReducedMotionChange(event) {
  prefersReducedMotion.value = event.matches
}

// 'feed-move-suppressed' has no transition, so the TransitionGroup bails out of
// the move handling instead of measuring and translating every child.
const moveClass = computed(() => {
  const suppressed = suppressMoveTransition.value ||
    prefersReducedMotion.value ||
    props.itemCount > MOVE_TRANSITION_MAX_ITEMS

  return suppressed ? 'feed-move-suppressed' : undefined
})

const gridStyle = computed(() => {
  return getThumbnailSizeStyles(props.thumbnailSize, gridWidth.value)
})

function captureLeavingItemLayout(element) {
  const itemRect = element.getBoundingClientRect()
  const gridRect = gridElement.value.$el.getBoundingClientRect()

  element.style.setProperty('--feed-leave-width', `${itemRect.width}px`)
  element.style.setProperty('--feed-leave-height', `${itemRect.height}px`)
  element.style.setProperty('--feed-leave-left', `${itemRect.left - gridRect.left}px`)
  element.style.setProperty('--feed-leave-top', `${itemRect.top - gridRect.top}px`)
}

let resizeObserver = null
let observedScrollbarWidth = 0
let observedViewportWidth = null

onMounted(() => {
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = reducedMotionQuery.matches
  reducedMotionQuery.addEventListener('change', handleReducedMotionChange)

  resizeObserver = new ResizeObserver(([entry]) => {
    const scrollbarCompensated = document.body.style.overflow === 'hidden' &&
      document.body.style.paddingInlineEnd !== ''
    const measurement = measureStableGridWidth(
      entry.contentRect.width,
      observedScrollbarWidth,
      observedViewportWidth,
      window.innerWidth,
      document.documentElement.clientWidth,
      scrollbarCompensated
    )
    observedScrollbarWidth = measurement.scrollbarWidth
    observedViewportWidth = measurement.viewportWidth

    if (measurement.gridWidth !== gridWidth.value) {
      suppressMoveTransition.value = true
      clearTimeout(suppressResetTimeout)
      suppressResetTimeout = setTimeout(() => {
        suppressMoveTransition.value = false
      }, 100)
    }

    gridWidth.value = measurement.gridWidth
  })

  resizeObserver.observe(gridElement.value.$el)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  reducedMotionQuery?.removeEventListener('change', handleReducedMotionChange)
  clearTimeout(suppressResetTimeout)
})
</script>

<style scoped src="./FtAutoGrid.css" />
