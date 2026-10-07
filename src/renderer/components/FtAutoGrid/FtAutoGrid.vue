<template>
  <TransitionGroup
    ref="gridElement"
    tag="div"
    name="feed"
    :appear="appear"
    :move-class="moveClass"
    :style="{ '--feed-transition-duration': feedTransitionDuration }"
    :class="{
      autoGrid: true,
      grid: grid,
      list: !grid,
      thumbnailSizeReady: grid && thumbnailSizeReady,
      youtubeStyleShorts
    }"
    @before-leave="captureLeavingItemLayout"
  >
    <slot />
  </TransitionGroup>
</template>

<script setup>
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onBeforeUpdate, onDeactivated, onMounted, ref, useTemplateRef, watch } from 'vue'

import store from '../../store/index'

import { getThumbnailGridStyles, PHONE_THUMBNAIL_VIEWPORT_WIDTH } from '../../constants/thumbnailSize'
import { setThumbnailGridVisible, thumbnailSizeSettingKey } from '../../composables/useThumbnailSizeSlider'
import { getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import { measureStableGridWidth } from './gridWidth'
import { measureLeavingItemLayouts } from './leavingItemLayout'

const props = defineProps({
  appear: {
    type: Boolean,
    default: false
  },
  grid: {
    type: Boolean,
    required: true
  },
  itemCount: {
    type: Number,
    default: 0
  },
  itemKeys: {
    type: Array,
    default: null
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
const thumbnailSizeSetting = inject(thumbnailSizeSettingKey, 'thumbnailSize')
const feedTransitionDuration = computed(() => {
  return `${300 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)}ms`
})

// The thumbnail size custom properties are written straight to the element
// instead of through a reactive `:style` binding, and the measured width is
// kept out of the reactive graph: TransitionGroup's render function calls
// getBoundingClientRect() on every child, so any re-render of this component
// costs a layout pass over the whole feed. Dragging the thumbnail size slider
// emits an event per step, which turned that into hundreds of forced layouts.
let gridWidth = 0
let active = true

function updateGridSliderLimit() {
  const element = gridElement.value?.$el
  if (element) setThumbnailGridVisible(element, active && props.grid && gridWidth > 0, thumbnailSizeSetting)
}

watch(() => props.grid, updateGridSliderLimit)
onActivated(() => {
  active = true
  updateGridSliderLimit()
})
onDeactivated(() => {
  active = false
  updateGridSliderLimit()
})

// Only whether the width is known needs to reach the template, and that flips
// just once, right after mount.
const thumbnailSizeReady = ref(false)

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

function applyThumbnailSizeStyles() {
  const element = gridElement.value?.$el

  if (!element) {
    return
  }

  const styles = getThumbnailGridStyles(store.state.settings[thumbnailSizeSetting], gridWidth, window.innerWidth)

  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value)
  }
}

watch(() => store.state.settings[thumbnailSizeSetting], applyThumbnailSizeStyles)

let leavingItemLayouts = null
let pendingLeavingItems = []
onBeforeUpdate(() => {
  leavingItemLayouts = null
  pendingLeavingItems = []
  const grid = gridElement.value?.$el
  if (!props.itemKeys || !(grid instanceof Element) || grid.closest('.newFeed') === null) return
  const retainedKeys = new Set(props.itemKeys)
  const leaving = Array.from(grid.children).filter(element => (
    !retainedKeys.has(element.getAttribute('data-feed-item-key')) &&
    !element.classList.contains('feed-leave-active')
  ))
  if (leaving.length === 0) return
  leavingItemLayouts = measureLeavingItemLayouts(grid)
  pendingLeavingItems = leaving
  nextTick(() => { leavingItemLayouts = null })
})

function applyLeavingItemLayout(element) {
  const layout = leavingItemLayouts.get(element)
  if (!layout) return
  for (const [dimension, value] of Object.entries(layout)) {
    element.style.setProperty(`--feed-leave-${dimension}`, `${value}px`)
  }
}

function captureLeavingItemLayout(element) {
  // Only the New feed takes leaving items out of flow and consumes these
  // geometry variables. Measuring every removed card in other feeds forces
  // repeated layouts during a large subscription refresh.
  if (!(element instanceof Element) || element.closest('.newFeed') === null) {
    return
  }

  if (leavingItemLayouts === null) {
    leavingItemLayouts = measureLeavingItemLayouts(gridElement.value.$el)
    nextTick(() => { leavingItemLayouts = null })
  }
  // TransitionGroup has now captured the retained cards' original positions.
  // Vue forces a reflow in each leave hook. Position the entire departing
  // batch first so those reflows see no intervening layout-changing writes.
  for (const leaving of pendingLeavingItems) {
    applyLeavingItemLayout(leaving)
    leaving.classList.add('feed-leave-active')
  }
  pendingLeavingItems = []
  applyLeavingItemLayout(element)
}

let resizeObserver = null
let phoneWidthQuery = null
let observedScrollbarWidth = 0
let observedViewportWidth = null

onMounted(() => {
  phoneWidthQuery = window.matchMedia(`(width <= ${PHONE_THUMBNAIL_VIEWPORT_WIDTH}px)`)
  phoneWidthQuery.addEventListener('change', applyThumbnailSizeStyles)
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = reducedMotionQuery.matches
  reducedMotionQuery.addEventListener('change', handleReducedMotionChange)

  resizeObserver = new ResizeObserver(([entry]) => {
    const scrollbarCompensated = document.documentElement.style.overflow === 'hidden' &&
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

    if (measurement.gridWidth !== gridWidth) {
      suppressMoveTransition.value = true
      clearTimeout(suppressResetTimeout)
      suppressResetTimeout = setTimeout(() => {
        suppressMoveTransition.value = false
      }, 100)

      gridWidth = measurement.gridWidth
      updateGridSliderLimit()
      applyThumbnailSizeStyles()
      thumbnailSizeReady.value = gridWidth > 0
    }
  })

  resizeObserver.observe(gridElement.value.$el)
})

onBeforeUnmount(() => {
  active = false
  updateGridSliderLimit()
  resizeObserver?.disconnect()
  phoneWidthQuery?.removeEventListener('change', applyThumbnailSizeStyles)
  reducedMotionQuery?.removeEventListener('change', handleReducedMotionChange)
  clearTimeout(suppressResetTimeout)
})
</script>

<style scoped src="./FtAutoGrid.css" />
