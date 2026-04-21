<template>
  <div
    v-if="isElectron"
    class="tabBar"
  >
    <div
      ref="tabsViewportRef"
      class="tabsViewport"
      :class="{ hasScrollbar: showScrollbar }"
    >
      <div
        ref="dropZoneRef"
        class="tabsContainer"
        @scroll="handleScroll"
        @wheel.prevent="handleWheel"
        @pointerdown="handleTabContainerPointerDown"
      >
        <SortableTab
          v-for="(tab, index) in tabs"
          :key="tab.id"
          :tab="tab"
          :index="index"
          :offset="tabOffsets[tab.id] || 0"
          :is-dragging="draggingTabId === tab.id"
          :is-settling="isSettling && draggingTabId === tab.id"
          :suppress-transition="suppressTransitions"
          :close-label="t('Close Tab')"
          @activate="handleActivate"
          @close="closeTab"
          @middle-click="handleMiddleClick"
        />
      </div>
      <div
        v-show="showScrollbar"
        ref="scrollbarRef"
        class="tabsScrollbar"
        @pointerdown="handleScrollbarTrackPointerDown"
      >
        <div
          class="tabsScrollbarThumb"
          :style="scrollbarThumbStyle"
          @pointerdown.stop="handleScrollbarThumbPointerDown"
        />
      </div>
    </div>
    <button
      class="newTabButton"
      :aria-label="t('New Tab')"
      :title="newTabTooltip"
      @click="createNewTab"
    >
      <FontAwesomeIcon
        :icon="['fas', 'plus']"
        class="newTabIcon"
      />
    </button>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from '../../composables/use-i18n-polyfill'

import store from '../../store/index'
import { KeyboardShortcuts } from '../../../constants'
import { localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import SortableTab from './SortableTab.vue'

const { t } = useI18n()

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<Array<{id: string, url: string, title: string, isActive: boolean}>>} */
const tabs = computed(() => store.getters.getTabs)

const newTabTooltip = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('New Tab'),
    KeyboardShortcuts.APP.GENERAL.NEW_TAB
  )
})

const tabsViewportRef = useTemplateRef('tabsViewportRef')
const dropZoneRef = useTemplateRef('dropZoneRef')
const scrollbarRef = useTemplateRef('scrollbarRef')

// ===== Drag and drop state =====
const DRAG_THRESHOLD_PX = 5
const SETTLE_DURATION_MS = 180

/** @type {import('vue').Ref<string | null>} */
const draggingTabId = ref(null)
/** @type {import('vue').Ref<Record<string, number>>} */
const tabOffsets = ref({})
const isSettling = ref(false)
const suppressTransitions = ref(false)

/**
 * @typedef {object} DragSession
 * @property {string} tabId
 * @property {number} sourceIndex
 * @property {number} targetIndex
 * @property {number} pointerStartX
 * @property {Array<{id: string, left: number, width: number}>} rects
 * @property {number} gap
 * @property {boolean} started
 * @property {boolean} moved
 * @property {number} draggedOffset
 */

/** @type {DragSession | null} */
let dragSession = null
let settleTimeoutId = null

/**
 * Begin tracking a potential drag from a tab.
 * @param {PointerEvent} event
 */
function handleTabContainerPointerDown(event) {
  if (event.button !== 0) return

  const target = event.target
  if (!(target instanceof Element)) return

  // Ignore clicks on the close button
  if (target.closest('.closeButton')) return

  const tabEl = target.closest('.tab[data-tab-id]')
  if (!(tabEl instanceof HTMLElement)) return

  const container = dropZoneRef.value
  if (!container) return

  const tabId = tabEl.dataset.tabId
  const tabsList = tabs.value
  const sourceIndex = tabsList.findIndex(t => t.id === tabId)
  if (sourceIndex === -1) return

  const tabEls = Array.from(container.querySelectorAll('.tab[data-tab-id]'))
  if (tabEls.length === 0) return

  const containerRect = container.getBoundingClientRect()
  const containerScrollLeft = container.scrollLeft

  // Layout left = position within the scrollable content (so it stays
  // consistent regardless of the current scroll offset).
  const rects = tabEls.map(el => {
    const rect = el.getBoundingClientRect()
    return {
      id: el.dataset.tabId,
      left: rect.left - containerRect.left + containerScrollLeft,
      width: rect.width
    }
  })

  // Compute the gap between adjacent tabs (matches the .tabsContainer gap)
  let gap = 0
  if (rects.length > 1) {
    gap = rects[1].left - (rects[0].left + rects[0].width)
  }

  finishSettle(true)

  dragSession = {
    tabId,
    sourceIndex,
    targetIndex: sourceIndex,
    pointerStartX: event.clientX,
    rects,
    gap,
    started: false,
    moved: false,
    draggedOffset: 0
  }

  window.addEventListener('pointermove', handleDragPointerMove)
  window.addEventListener('pointerup', handleDragPointerUp)
  window.addEventListener('pointercancel', handleDragPointerCancel)
}

/**
 * @param {PointerEvent} event
 */
function handleDragPointerMove(event) {
  if (!dragSession) return

  const dx = event.clientX - dragSession.pointerStartX

  if (!dragSession.started) {
    if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
    dragSession.started = true
    draggingTabId.value = dragSession.tabId
    document.body.classList.add('tab-dragging')
  }

  dragSession.moved = true
  // Prevent text selection while dragging
  event.preventDefault()

  const { rects, sourceIndex, gap } = dragSession
  const sourceRect = rects[sourceIndex]
  const lastRect = rects[rects.length - 1]

  // Clamp so the dragged tab's center can sweep across the entire row
  // (from the very left edge to the very right edge of the strip). Anything
  // tighter would prevent reaching the leftmost / rightmost slot when the
  // dragged tab is at least as wide as its neighbours.
  const minLeft = rects[0].left - sourceRect.width / 2
  const maxLeft = lastRect.left + lastRect.width - sourceRect.width / 2
  const newLeft = Math.max(minLeft, Math.min(maxLeft, sourceRect.left + dx))
  const draggedOffset = newLeft - sourceRect.left
  const draggedCenter = newLeft + sourceRect.width / 2

  dragSession.draggedOffset = draggedOffset

  // Determine the target slot by comparing the dragged tab's center
  // against the centers of the other (stationary, original layout) tabs.
  let targetIndex = sourceIndex
  for (let i = 0; i < rects.length; i++) {
    if (i === sourceIndex) continue
    const center = rects[i].left + rects[i].width / 2
    if (i < sourceIndex && draggedCenter < center) {
      targetIndex = Math.min(targetIndex, i)
    } else if (i > sourceIndex && draggedCenter > center) {
      targetIndex = Math.max(targetIndex, i)
    }
  }

  dragSession.targetIndex = targetIndex

  tabOffsets.value = computeOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset)
}

/**
 * Build the offset map for every tab given the proposed reorder.
 * The dragged tab gets the user's pointer offset; all other tabs animate
 * to the slot they would occupy in the reordered layout.
 * @param {Array<{id: string, left: number, width: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  const offsets = {}

  if (sourceIndex === targetIndex) {
    offsets[rects[sourceIndex].id] = draggedOffset
    return offsets
  }

  const order = rects.map((_, i) => i)
  const [src] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, src)

  let cursor = rects[0].left
  for (const idx of order) {
    const rect = rects[idx]
    if (idx === sourceIndex) {
      offsets[rect.id] = draggedOffset
    } else {
      const delta = cursor - rect.left
      if (delta !== 0) {
        offsets[rect.id] = delta
      }
    }
    cursor += rect.width + gap
  }

  return offsets
}

function handleDragPointerUp() {
  cleanupDragListeners()

  if (!dragSession) return

  const { sourceIndex, targetIndex, started, moved, tabId, rects, gap, draggedOffset } = dragSession

  if (started && moved) {
    suppressNextClick()
  }

  document.body.classList.remove('tab-dragging')

  if (!started) {
    // Treated as a click; let the regular click handler activate the tab.
    dragSession = null
    return
  }

  // Snap the dragged tab to its final slot with an animation, then commit
  // the reorder once the snap finishes. Other tabs are already shifted to
  // their target positions via offsets, so they'll stay put through the swap.
  const snapOffsets = computeFinalOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset)

  tabOffsets.value = snapOffsets
  draggingTabId.value = null
  isSettling.value = true

  settleTimeoutId = window.setTimeout(() => {
    settleTimeoutId = null
    commitReorder(tabId, sourceIndex, targetIndex)
  }, SETTLE_DURATION_MS)

  dragSession = null
}

/**
 * Compute offsets that place every tab (including the dragged one)
 * exactly where it will live after the reorder commits.
 * @param {Array<{id: string, left: number, width: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeFinalOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  if (sourceIndex === targetIndex) {
    // Dragged tab returns to its origin; other tabs already at 0.
    return {}
  }

  const offsets = computeOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset)

  // Replace the dragged tab's pointer-following offset with the snap-to-slot offset.
  const order = rects.map((_, i) => i)
  const [src] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, src)

  let cursor = rects[0].left
  for (const idx of order) {
    if (idx === sourceIndex) {
      offsets[rects[idx].id] = cursor - rects[idx].left
      break
    }
    cursor += rects[idx].width + gap
  }

  return offsets
}

/**
 * Commit the reorder to the store, then reset transforms without animating
 * (so the elements don't jump from their offset positions back to 0).
 * @param {string} tabId
 * @param {number} sourceIndex
 * @param {number} targetIndex
 */
function commitReorder(tabId, sourceIndex, targetIndex) {
  if (sourceIndex !== targetIndex) {
    suppressTransitions.value = true
    store.dispatch('moveTab', { tabId, toIndex: targetIndex })
  }

  tabOffsets.value = {}
  isSettling.value = false

  nextTick(() => {
    requestAnimationFrame(() => {
      suppressTransitions.value = false
    })
  })
}

function handleDragPointerCancel() {
  cleanupDragListeners()
  document.body.classList.remove('tab-dragging')

  if (!dragSession) return

  if (dragSession.started) {
    // Animate the dragged tab back to its slot; other offsets are already
    // shifted toward the proposed target, so animate them back to 0 too.
    tabOffsets.value = {}
    draggingTabId.value = null
    isSettling.value = true

    settleTimeoutId = window.setTimeout(() => {
      settleTimeoutId = null
      isSettling.value = false
    }, SETTLE_DURATION_MS)
  }

  dragSession = null
}

function cleanupDragListeners() {
  window.removeEventListener('pointermove', handleDragPointerMove)
  window.removeEventListener('pointerup', handleDragPointerUp)
  window.removeEventListener('pointercancel', handleDragPointerCancel)
}

/**
 * If a settle animation is currently in progress, finish it immediately so a
 * new drag starts from a clean state.
 * @param {boolean} cancel
 */
function finishSettle(cancel) {
  if (settleTimeoutId != null) {
    clearTimeout(settleTimeoutId)
    settleTimeoutId = null
  }
  if (cancel) {
    suppressTransitions.value = true
    tabOffsets.value = {}
    isSettling.value = false
    nextTick(() => {
      requestAnimationFrame(() => {
        suppressTransitions.value = false
      })
    })
  }
}

/**
 * Suppress the `click` event that would otherwise fire after a drag completes.
 */
function suppressNextClick() {
  const handler = (event) => {
    event.stopPropagation()
    event.preventDefault()
    window.removeEventListener('click', handler, true)
  }
  window.addEventListener('click', handler, true)
  // Safety net: drop the listener if no click ever fires (pointer released
  // outside the source element so no click event is dispatched).
  setTimeout(() => {
    window.removeEventListener('click', handler, true)
  }, 200)
}

// ===== Tab actions =====
/**
 * @param {string} tabId
 */
function handleActivate(tabId) {
  store.dispatch('activateTab', tabId)
}

/**
 * @param {string} tabId
 */
async function closeTab(tabId) {
  const hasRemainingTabs = await store.dispatch('closeTab', tabId)
  if (!hasRemainingTabs) {
    window.close()
  }
}

/**
 * @param {MouseEvent} event
 * @param {string} tabId
 */
function handleMiddleClick(event, tabId) {
  if (event.button === 1) {
    closeTab(tabId)
  }
}

function createNewTab() {
  store.dispatch('createTab', { makeActive: true })
}

// ===== Context menu =====
/**
 * @param {{ tabId: string | null, isTabBar: boolean }} payload
 */
function updateContextMenuTab(payload) {
  window.ftElectron.tabs.setContextMenuTab(payload)
}

/**
 * @param {PointerEvent} event
 */
function handleContextMenuPointerDown(event) {
  if (!isElectron || event.button !== 2 || !(event.target instanceof Element)) {
    return
  }

  const tabId = event.target.closest('.tab[data-tab-id]')?.dataset.tabId ?? null
  const isTabBar = event.target.closest('.tabBar') != null
  updateContextMenuTab({ tabId, isTabBar })
}

/**
 * @param {MouseEvent} event
 */
function handleContextMenuEvent(event) {
  if (!isElectron || !(event.target instanceof Element)) {
    return
  }

  const tabId = event.target.closest('.tab[data-tab-id]')?.dataset.tabId ?? null
  const isTabBar = event.target.closest('.tabBar') != null
  updateContextMenuTab({ tabId, isTabBar })
}

// ===== Lifecycle =====
onMounted(() => {
  if (isElectron) {
    store.dispatch('initializeTabs')
    document.addEventListener('pointerdown', handleContextMenuPointerDown, true)
    document.addEventListener('contextmenu', handleContextMenuEvent, true)
  }

  window.addEventListener('resize', handleWindowResize)

  nextTick(() => {
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        updateScrollbar()
      })

      if (tabsViewportRef.value) {
        resizeObserver.observe(tabsViewportRef.value)
      }

      if (dropZoneRef.value) {
        resizeObserver.observe(dropZoneRef.value)
      }
    }

    updateScrollbar()
  })
})

onUnmounted(() => {
  if (isElectron) {
    document.removeEventListener('pointerdown', handleContextMenuPointerDown, true)
    document.removeEventListener('contextmenu', handleContextMenuEvent, true)
    updateContextMenuTab({ tabId: null, isTabBar: false })
  }

  cleanupDragListeners()
  if (settleTimeoutId != null) {
    clearTimeout(settleTimeoutId)
    settleTimeoutId = null
  }

  stopScrollbarThumbDrag()
  cancelScrollAnimation()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', handleWindowResize)
  document.body.classList.remove('tab-dragging')
})

// ===== Scrollbar =====
const tabBarScrollPosition = computed(() => store.getters.getTabBarScrollPosition)
const showScrollbar = ref(false)
const scrollbarThumbWidth = ref(0)
const scrollbarThumbOffset = ref(0)

let scrollTarget = null
let scrollAnimationId = null
let resizeObserver = null
let scrollbarDragState = null

const MIN_SCROLLBAR_THUMB_WIDTH = 24

const scrollbarThumbStyle = computed(() => {
  return {
    inlineSize: `${scrollbarThumbWidth.value}px`,
    transform: `translateX(${scrollbarThumbOffset.value}px)`
  }
})

function animateScroll() {
  const container = dropZoneRef.value
  if (!container || scrollTarget == null) {
    scrollAnimationId = null
    return
  }

  const diff = scrollTarget - container.scrollLeft
  if (Math.abs(diff) < 0.5) {
    container.scrollLeft = scrollTarget
    scrollTarget = null
    scrollAnimationId = null
    updateScrollbar()
    return
  }

  container.scrollLeft += diff * 0.25
  updateScrollbar()
  scrollAnimationId = requestAnimationFrame(animateScroll)
}

function cancelScrollAnimation() {
  if (scrollAnimationId != null) {
    cancelAnimationFrame(scrollAnimationId)
    scrollAnimationId = null
  }

  if (dropZoneRef.value) {
    scrollTarget = dropZoneRef.value.scrollLeft
  }
}

function updateScrollbar() {
  const container = dropZoneRef.value
  const viewport = tabsViewportRef.value

  if (!container || !viewport) {
    return
  }

  const maxScroll = container.scrollWidth - container.clientWidth

  if (maxScroll <= 1) {
    showScrollbar.value = false
    scrollbarThumbWidth.value = 0
    scrollbarThumbOffset.value = 0
    return
  }

  showScrollbar.value = true

  const trackWidth = viewport.clientWidth
  const visibleRatio = container.clientWidth / container.scrollWidth
  const thumbWidth = Math.min(
    trackWidth,
    Math.max(Math.round(trackWidth * visibleRatio), MIN_SCROLLBAR_THUMB_WIDTH)
  )
  const maxThumbOffset = Math.max(0, trackWidth - thumbWidth)
  const thumbOffset = maxScroll > 0
    ? (container.scrollLeft / maxScroll) * maxThumbOffset
    : 0

  scrollbarThumbWidth.value = thumbWidth
  scrollbarThumbOffset.value = Math.max(0, Math.min(maxThumbOffset, thumbOffset))
}

/**
 * @param {WheelEvent} event
 */
function handleWheel(event) {
  const container = dropZoneRef.value
  if (!container) return

  const delta = event.deltaY || event.deltaX
  const maxScroll = container.scrollWidth - container.clientWidth

  if (scrollTarget == null) {
    scrollTarget = container.scrollLeft
  }
  scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget + delta))

  if (isElectron) {
    window.ftElectron.tabs.setTabBarScroll(scrollTarget)
  }

  if (!scrollAnimationId) {
    scrollAnimationId = requestAnimationFrame(animateScroll)
  }
}

function handleScroll() {
  updateScrollbar()
}

/**
 * @param {PointerEvent} event
 */
function handleScrollbarTrackPointerDown(event) {
  if (event.button !== 0 || event.target.closest('.tabsScrollbarThumb')) {
    return
  }

  const container = dropZoneRef.value
  const scrollbar = scrollbarRef.value
  if (!container || !scrollbar) return

  event.preventDefault()
  cancelScrollAnimation()

  const maxScroll = container.scrollWidth - container.clientWidth
  const maxThumbOffset = scrollbar.clientWidth - scrollbarThumbWidth.value
  const trackRect = scrollbar.getBoundingClientRect()
  const desiredThumbOffset = event.clientX - trackRect.left - scrollbarThumbWidth.value / 2
  const clampedThumbOffset = Math.max(0, Math.min(maxThumbOffset, desiredThumbOffset))
  const nextScrollLeft = maxThumbOffset > 0
    ? (clampedThumbOffset / maxThumbOffset) * maxScroll
    : 0

  container.scrollLeft = nextScrollLeft
  if (isElectron) {
    window.ftElectron.tabs.setTabBarScroll(nextScrollLeft)
  }
  updateScrollbar()
}

/**
 * @param {PointerEvent} event
 */
function handleScrollbarThumbPointerDown(event) {
  if (event.button !== 0) {
    return
  }

  const container = dropZoneRef.value
  const scrollbar = scrollbarRef.value
  if (!container || !scrollbar) return

  const maxScroll = container.scrollWidth - container.clientWidth
  const maxThumbOffset = scrollbar.clientWidth - scrollbarThumbWidth.value
  if (maxScroll <= 0 || maxThumbOffset <= 0) {
    return
  }

  event.preventDefault()
  cancelScrollAnimation()

  scrollbarDragState = {
    startX: event.clientX,
    startScrollLeft: container.scrollLeft,
    maxScroll,
    maxThumbOffset
  }

  window.addEventListener('pointermove', handleScrollbarThumbPointerMove)
  window.addEventListener('pointerup', stopScrollbarThumbDrag)
  window.addEventListener('pointercancel', stopScrollbarThumbDrag)
}

/**
 * @param {PointerEvent} event
 */
function handleScrollbarThumbPointerMove(event) {
  if (!scrollbarDragState || !dropZoneRef.value) {
    return
  }

  const deltaX = event.clientX - scrollbarDragState.startX
  const nextScrollLeft = scrollbarDragState.startScrollLeft +
    (deltaX / scrollbarDragState.maxThumbOffset) * scrollbarDragState.maxScroll
  const clampedScrollLeft = Math.max(0, Math.min(scrollbarDragState.maxScroll, nextScrollLeft))

  dropZoneRef.value.scrollLeft = clampedScrollLeft
  if (isElectron) {
    window.ftElectron.tabs.setTabBarScroll(clampedScrollLeft)
  }
  updateScrollbar()
}

function stopScrollbarThumbDrag() {
  scrollbarDragState = null
  window.removeEventListener('pointermove', handleScrollbarThumbPointerMove)
  window.removeEventListener('pointerup', stopScrollbarThumbDrag)
  window.removeEventListener('pointercancel', stopScrollbarThumbDrag)
}

function handleWindowResize() {
  updateScrollbar()
}

// Apply scroll position received from main process state broadcasts.
// This keeps all tab renderers' tab bars at the same scroll offset.
watch(tabBarScrollPosition, (newPosition) => {
  if (newPosition == null) return

  nextTick(() => {
    const container = dropZoneRef.value
    if (!container) return

    if (scrollAnimationId) {
      scrollTarget = newPosition
    } else {
      container.scrollLeft = newPosition
      scrollTarget = newPosition
    }

    updateScrollbar()
  })
})

watch(tabs, () => {
  nextTick(() => {
    updateScrollbar()
  })
}, { deep: true })
</script>

<style scoped src="./TabBar.css" />

<style>
body.tab-dragging,
body.tab-dragging * {
  cursor: grabbing !important;
  user-select: none !important;
}
</style>
