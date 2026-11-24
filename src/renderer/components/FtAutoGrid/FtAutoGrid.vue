<template>
  <TransitionGroup
    ref="gridElement"
    tag="div"
    name="feed"
    :appear="appear"
    :duration="getTransitionDurations()"
    :move-class="getMoveClass()"
    :data-skip-move="getMoveClass() === 'feed-move-suppressed' ? '' : null"
    :data-feed-enter-together="appear && !reducedMotion ? '' : null"
    :style="{ '--feed-transition-duration': feedTransitionDuration }"
    :class="{
      autoGrid: true,
      grid: grid,
      list: !grid,
      thumbnailSizeReady: grid && thumbnailSizeReady,
      fullWidth: grid && !youtubeStyleShorts && fullWidth,
      youtubeStyleShorts
    }"
    @before-leave="handleBeforeLeave"
    @keydown="moveTileFocus"
  >
    <slot />
  </TransitionGroup>
</template>

<script setup>
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onBeforeUpdate, onDeactivated, onMounted, onUpdated, provide, ref, shallowRef, useTemplateRef, watch } from 'vue'

import store from '../../store/index'

import { getThumbnailGridSizes, getThumbnailGridStyles, getThumbnailListSizes, PHONE_THUMBNAIL_VIEWPORT_WIDTH } from '../../constants/thumbnailSize'
import { getUiDensityScale } from '../../constants/uiDensity'
import { thumbnailSizesKey } from '../../helpers/videoThumbnail.js'
import { GRID_COLUMNS_SETTINGS, getGridColumns, setThumbnailGridVisible, thumbnailSizeSettingKey, VIEW_TYPE_SETTINGS } from '../../composables/useThumbnailSizeSlider'
import { applyAnimationSpeed, getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { getLastScrollY, getViewportWidth } from '../../helpers/viewport'
import { measureLeavingItemLayouts } from './leavingItemLayout'
import { findAdjacentTileIndex, focusTile, getPageTiles, getTileDirection, isTileFocusable, tileKeyboardShortcutsKey } from '../../helpers/tileNavigation'

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
  },
  // Set while a drag positions the items itself and commits their new order.
  disableMoveTransition: {
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
provide(tileKeyboardShortcutsKey, true)
const thumbnailSizeSetting = inject(thumbnailSizeSettingKey, 'thumbnailSize')
const getCardSizes = styles => getThumbnailGridSizes(Number.parseFloat(styles['--thumbnail-grid-size']))
// Only the thumbnails read this, so a new card width does not re-render the
// grid. Until the grid is measured, cards have their default width.
const gridThumbnailSizes = shallowRef(getCardSizes(getThumbnailGridStyles(store.state.settings[thumbnailSizeSetting])))
provide(thumbnailSizesKey, computed(() => props.grid ? gridThumbnailSizes.value : getThumbnailListSizes(store.state.settings[thumbnailSizeSetting])))
const animationSpeedMultiplier = computed(() => getAnimationSpeedMultiplier(store.getters.getAnimationSpeed))
const feedTransitionDuration = computed(() => `${300 / animationSpeedMultiplier.value}ms`)

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
  keepBottomGeneration++
  active = false
  updateGridSliderLimit()
})

// Only whether the width is known needs to reach the template, and that flips
// just once, right after mount.
const thumbnailSizeReady = ref(false)

// While the container itself is being sized or resized (initial layout or
// window resize), the FLIP move transition must not run — it should only
// animate actual list changes. 'feed-move-suppressed' has no transition, so
// the TransitionGroup skips the move handling entirely. Only renders during
// the resize read this. Rendering again just to lift it would have
// TransitionGroup measure every card, which ran 100 ms after each grid
// mounted, such as while its page was still opening.
let suppressMoveTransition = false
let suppressResetTimeout = null

const systemReducedMotion = usePhoneLayout('(prefers-reduced-motion: reduce)')
const reducedMotion = computed(() => store.getters.getReducedMotion === 'on' ||
  (store.getters.getReducedMotion === 'system' && systemReducedMotion.value))

// Only the New feed fades departing cards; other lists remove them immediately.
// Cards only leave in later renders, so this is known by then. Reading the
// template ref while rendering instead rendered every grid a second time once
// it mounted, and TransitionGroup measures each card for that render.
let inNewFeed = false

// Vue otherwise infers timing with getComputedStyle for every entering card,
// interleaving style reads with class writes across the whole incoming batch.
function getTransitionDurations() {
  return {
    enter: reducedMotion.value ? 0 : 300 / animationSpeedMultiplier.value,
    leave: reducedMotion.value || !inNewFeed ? 0 : 200 / animationSpeedMultiplier.value
  }
}

// 'feed-move-suppressed' has no transition, and data-skip-move tells the
// patched TransitionGroup not to measure every child before each update.
function getMoveClass() {
  const suppressed = suppressMoveTransition ||
    props.disableMoveTransition ||
    reducedMotion.value ||
    props.itemCount > MOVE_TRANSITION_MAX_ITEMS

  return suppressed ? 'feed-move-suppressed' : undefined
}

const fullWidth = computed(() => store.state.settings[VIEW_TYPE_SETTINGS[thumbnailSizeSetting]] === 'fullWidth')

function applyThumbnailSizeStyles() {
  const element = gridElement.value?.$el

  if (!element) {
    return
  }

  const styles = getThumbnailGridStyles(
    store.state.settings[thumbnailSizeSetting],
    gridWidth,
    getViewportWidth(),
    gridWidth,
    getGridColumns(thumbnailSizeSetting),
    getUiDensityScale(store.state.settings.uiDensity)
  )

  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value)
  }
  gridThumbnailSizes.value = getCardSizes(styles)
}

watch(() => [
  store.state.settings[thumbnailSizeSetting],
  store.state.settings[VIEW_TYPE_SETTINGS[thumbnailSizeSetting]],
  store.state.settings[GRID_COLUMNS_SETTINGS[thumbnailSizeSetting]],
  store.state.settings.uiDensity
], applyThumbnailSizeStyles)

// Items that fill an empty grid all fade in at once, so the grid fades in
// for them: one animated element instead of one per card. Chromium restyles
// every animated element on each frame the page renders around them, which
// on a feed of hundreds of cards slows the page that is opening.
const ENTER_TOGETHER_ATTRIBUTE = 'data-feed-enter-together'
let fillingEmptyGrid = false
/** @type {Animation | null} */
let enterTogetherAnimation = null

/** @param {Element} grid */
function enterTogether(grid) {
  if (grid.childElementCount === 0 || reducedMotion.value) {
    grid.removeAttribute(ENTER_TOGETHER_ATTRIBUTE)
    return
  }
  enterTogetherAnimation?.cancel()
  const animation = applyAnimationSpeed(grid.animate(
    { opacity: [0, 1], translate: ['0 10px', '0 0'] },
    { duration: 300, easing: 'ease' }
  ))
  enterTogetherAnimation = animation
  animation.finished.then(() => {
    if (enterTogetherAnimation !== animation) return
    enterTogetherAnimation = null
    grid.removeAttribute(ENTER_TOGETHER_ATTRIBUTE)
  }, () => {})
}

onUpdated(() => {
  const grid = gridElement.value?.$el
  if (fillingEmptyGrid && grid instanceof Element) enterTogether(grid)
  fillingEmptyGrid = false
})

let leavingItemLayouts = null
let pendingLeavingItems = []
onBeforeUpdate(() => {
  leavingItemLayouts = null
  pendingLeavingItems = []
  const grid = gridElement.value?.$el
  fillingEmptyGrid = grid instanceof Element && grid.childElementCount === 0 && !reducedMotion.value
  if (fillingEmptyGrid) grid.setAttribute(ENTER_TOGETHER_ATTRIBUTE, '')
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

/**
 * Moves focus between tiles with the arrow keys once a tile has focus.
 * @param {KeyboardEvent} event
 */
function moveTileFocus(event) {
  const grid = gridElement.value?.$el
  if (!(grid instanceof Element) || !(event.target instanceof Element)) return
  const direction = getTileDirection(event, getComputedStyle(grid).direction === 'rtl')
  if (direction === null) return

  const tiles = getPageTiles(grid).filter(isTileFocusable)
  const index = tiles.findIndex(tile => tile.contains(event.target))
  if (index === -1) return

  // Left and right follow the tile order, so only up and down need geometry.
  const horizontal = direction === 'previous' || direction === 'next'
  const rects = tiles.map(tile => horizontal ? null : tile.getBoundingClientRect())
  const adjacentIndex = findAdjacentTileIndex(rects, index, direction)
  // Without a tile in that direction, the key keeps scrolling the page.
  if (adjacentIndex === -1) return
  event.preventDefault()
  focusTile(tiles[adjacentIndex])
  store.dispatch('showOutlines')
}

/**
 * Hands focus to the next tile, or else the previous one, when the focused
 * tile leaves, such as after it was marked as seen in the New feed.
 * @param {Element} element
 */
function keepFocusOnTiles(element) {
  const grid = gridElement.value?.$el
  if (!(grid instanceof Element) || !element.contains(document.activeElement)) return
  const tiles = getPageTiles(grid)
  const index = tiles.indexOf(element)
  const candidates = [...tiles.slice(index + 1), ...tiles.slice(0, index).reverse()]
  // Wait until every tile that leaves in this update has been marked.
  nextTick(() => {
    const activeElement = document.activeElement
    if (activeElement !== null && activeElement !== document.body && !element.contains(activeElement)) return
    const tile = candidates.find(isTileFocusable)
    if (tile) focusTile(tile)
  })
}

/** @param {Element} element */
function handleBeforeLeave(element) {
  captureLeavingItemLayout(element)
  keepFocusOnTiles(element)
}

let resizeObserver = null
let phoneWidthQuery = null
let pageAtBottom = false

// A newer measurement, deactivation or unmount cancels pending settle frames.
let keepBottomGeneration = 0

function keepPageAtBottom(frames, generation) {
  if (generation !== keepBottomGeneration) return
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  const target = window.scrollY
  if (frames > 0) {
    requestAnimationFrame(() => {
      if (generation !== keepBottomGeneration) return
      // Growing rows leave the position in place and shrinking ones keep it at
      // the end. A position above both means the page was scrolled away.
      const root = document.documentElement
      const atBottom = root.scrollHeight - root.clientHeight - window.scrollY <= 2
      if (window.scrollY < target - 2 && !atBottom) return
      keepPageAtBottom(frames - 1, generation)
    })
  }
}

function updatePageAtBottom() {
  // Only a scrolled page can be at its end, and reading whether it is lays out
  // a page that has changed since the last layout, such as one mounting.
  if (getLastScrollY() <= 0) {
    pageAtBottom = false
    return
  }
  const root = document.documentElement
  pageAtBottom = window.scrollY > 0 && root.scrollHeight - root.clientHeight - window.scrollY <= 2
}

/**
 * @param {number} contentWidth
 * @param {boolean} [viewportCrossedPhoneWidth]
 */
function updateGridWidth(contentWidth, viewportCrossedPhoneWidth = false) {
  const element = gridElement.value?.$el
  if (!element) return

  if (contentWidth !== gridWidth) {
    // Scroll anchoring keeps the top visible card in place, which leaves a
    // page that was scrolled to its end above the new end. This includes the
    // first measurement, when a grid replaces a list at the end of the page.
    // Resize observations run after layout and any restored scroll position.
    if (gridWidth === 0) updatePageAtBottom()
    const keepBottom = pageAtBottom && contentWidth > 0 && !element.closest('[inert]')
    suppressMoveTransition = true
    clearTimeout(suppressResetTimeout)
    suppressResetTimeout = setTimeout(() => {
      suppressMoveTransition = false
    }, 100)

    gridWidth = contentWidth
    updateGridSliderLimit()
    applyThumbnailSizeStyles()
    thumbnailSizeReady.value = gridWidth > 0
    // thumbnailSizeReady resizes the cards once Vue renders it, and windowed
    // rows settle their measured size over the following frames.
    if (keepBottom) {
      const generation = ++keepBottomGeneration
      nextTick(() => keepPageAtBottom(2, generation))
    }
    // The cards resize with the new width, and the observation for that
    // updates whether the page is at its end.
    return
  }
  if (viewportCrossedPhoneWidth) {
    // Applies the phone column minimum to a constrained grid.
    applyThumbnailSizeStyles()
  }
  updatePageAtBottom()
}

// A grid whose width stays the same still changes its phone column minimum.
// The stored width belongs to the previous layout, so measure the new one.
function handlePhoneWidthChange() {
  const element = gridElement.value?.$el
  if (!element || gridWidth === 0) return
  const style = getComputedStyle(element)
  const horizontalInsets = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
    .reduce((total, property) => total + (Number.parseFloat(style[property]) || 0), 0)
  updateGridWidth(element.getBoundingClientRect().width - horizontalInsets, true)
}

onMounted(() => {
  inNewFeed = gridElement.value.$el.closest('.newFeed') !== null
  phoneWidthQuery = window.matchMedia(`(width <= ${PHONE_THUMBNAIL_VIEWPORT_WIDTH}px)`)
  phoneWidthQuery.addEventListener('change', handlePhoneWidthChange)

  resizeObserver = new ResizeObserver(([entry]) => updateGridWidth(entry.contentRect.width))
  resizeObserver.observe(gridElement.value.$el)
  window.addEventListener('scroll', updatePageAtBottom, { passive: true })
  if (props.appear) enterTogether(gridElement.value.$el)
})

onBeforeUnmount(() => {
  // A New feed category unmounts its whole grid once its last tile leaves.
  const focusedTile = Array.from(gridElement.value?.$el?.children ?? [])
    .find(tile => tile.contains(document.activeElement))
  if (focusedTile) keepFocusOnTiles(focusedTile)
  keepBottomGeneration++
  active = false
  updateGridSliderLimit()
  resizeObserver?.disconnect()
  phoneWidthQuery?.removeEventListener('change', handlePhoneWidthChange)
  window.removeEventListener('scroll', updatePageAtBottom)
  clearTimeout(suppressResetTimeout)
})
</script>

<style scoped src="./FtAutoGrid.css" />
