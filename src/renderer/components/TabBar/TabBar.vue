<template>
  <div
    v-if="isElectron"
    ref="tabBarRef"
    class="tabBar"
    :class="{ vertical }"
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
        @wheel="handleWheel"
        @pointerdown="handleTabContainerPointerDown"
        @mousedown.middle="handleTabListMiddleMouseDown"
        @auxclick="handleTabListAuxClick"
      >
        <SortableTab
          v-for="(tab, index) in tabs"
          :key="tab.id"
          :tab="tab"
          :index="index"
          :vertical="vertical"
          :offset="tabOffsets[tab.id] || 0"
          :is-dragging="draggingTabId === tab.id"
          :is-settling="isSettling && draggingTabId === tab.id"
          :suppress-transition="suppressTransitions"
          :disable-tooltips="draggingTabId != null"
          :close-tooltips-signal="closeTooltipsSignal"
          :show-icon="showTabIcons"
          :close-label="t('Close Tab')"
          @activate="handleActivate"
          @close="closeTab"
          @middle-click="handleMiddleClick"
        />
      </div>
      <div
        v-show="showScrollbar && !vertical"
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
    <div
      v-if="vertical"
      class="tabBarResizeHandle"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('Resize Tab Bar')"
      :title="t('Resize Tab Bar')"
      @pointerdown="handleResizePointerDown"
      @dblclick="resetTabBarWidth"
    />
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { getConfiguredKeyboardShortcuts } from '../../../constants'
import { localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import SortableTab from './SortableTab.vue'

const { t } = useI18n()
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<Array<{id: string, url: string, title: string, isActive: boolean, isPinned?: boolean, color?: string | null}>>} */
const tabs = computed(() => store.getters.getTabs)

/** @type {import('vue').ComputedRef<boolean>} */
const vertical = computed(() => store.getters.getUseVerticalTabBar)
const showTabIcons = computed(() => store.getters.getShowTabIcons)

const newTabTooltip = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('New Tab'),
    appKeyboardShortcuts.value.NEW_TAB
  )
})

const tabBarRef = useTemplateRef('tabBarRef')
const tabsViewportRef = useTemplateRef('tabsViewportRef')
const dropZoneRef = useTemplateRef('dropZoneRef')
const scrollbarRef = useTemplateRef('scrollbarRef')
const closeTooltipsSignal = ref(0)

// ===== Drag and drop state =====
const DRAG_THRESHOLD_PX = 5
const SETTLE_DURATION_MS = 180
const REORDER_STATE_UPDATE_TIMEOUT_MS = 300

/** @type {import('vue').Ref<string | null>} */
const draggingTabId = ref(null)
/** @type {import('vue').Ref<Record<string, number>>} */
const tabOffsets = ref({})
const isSettling = ref(false)
const suppressTransitions = ref(false)

/**
 * Drag positions are measured along the tab bar's main axis:
 * horizontal (clientX/scrollLeft) normally, vertical (clientY/scrollTop)
 * when the vertical tab bar layout is enabled.
 * @typedef {object} DragSession
 * @property {string} tabId
 * @property {number} sourceIndex
 * @property {number} targetIndex
 * @property {number} pointerStart
 * @property {number} pointerCurrent
 * @property {number} scrollStart
 * @property {Array<{id: string, start: number, size: number}>} rects
 * @property {number} gap
 * @property {boolean} started
 * @property {boolean} moved
 * @property {number} draggedOffset
 */

/** @type {DragSession | null} */
let dragSession = null
let settleTimeoutId = null

/**
 * @param {PointerEvent | MouseEvent} event
 */
function pointerAxisPosition(event) {
  return vertical.value ? event.clientY : event.clientX
}

/**
 * @param {HTMLElement} container
 */
function containerScrollPosition(container) {
  return vertical.value ? container.scrollTop : container.scrollLeft
}

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
  const containerScroll = containerScrollPosition(container)

  // Layout start = position within the scrollable content (so it stays
  // consistent regardless of the current scroll offset).
  const rects = tabEls.map(el => {
    const rect = el.getBoundingClientRect()
    return {
      id: el.dataset.tabId,
      start: (vertical.value ? rect.top - containerRect.top : rect.left - containerRect.left) + containerScroll,
      size: vertical.value ? rect.height : rect.width
    }
  })

  // Compute the gap between adjacent tabs (matches the .tabsContainer gap)
  let gap = 0
  if (rects.length > 1) {
    gap = rects[1].start - (rects[0].start + rects[0].size)
  }

  finishSettle(true)

  dragSession = {
    tabId,
    sourceIndex,
    targetIndex: sourceIndex,
    pointerStart: pointerAxisPosition(event),
    pointerCurrent: pointerAxisPosition(event),
    scrollStart: containerScroll,
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

  dragSession.pointerCurrent = pointerAxisPosition(event)

  const pointerDelta = dragSession.pointerCurrent - dragSession.pointerStart

  if (!dragSession.started) {
    if (Math.abs(pointerDelta) < DRAG_THRESHOLD_PX) return
    dragSession.started = true
    draggingTabId.value = dragSession.tabId
    closeTooltipsSignal.value++
    document.body.classList.add('tab-bar-grabbing')
  }

  dragSession.moved = true
  // Prevent text selection while dragging
  event.preventDefault()

  updateActiveDragPosition()
}

function updateActiveDragPosition() {
  if (!dragSession || !dragSession.started) return

  const container = dropZoneRef.value
  if (!container) return

  const delta = dragSession.pointerCurrent -
    dragSession.pointerStart +
    containerScrollPosition(container) -
    dragSession.scrollStart

  const { rects, sourceIndex, gap } = dragSession
  const sourceRect = rects[sourceIndex]
  const lastRect = rects[rects.length - 1]
  const tabsList = tabs.value
  const sourceTab = tabsList[sourceIndex]
  const isSourcePinned = sourceTab?.isPinned === true

  // Clamp so the dragged tab's center can sweep across its allowed group.
  // Pinned tabs stay in the pinned group; unpinned tabs stay after it.
  let minStart = rects[0].start - sourceRect.size / 2
  let maxStart = lastRect.start + lastRect.size - sourceRect.size / 2

  if (isSourcePinned) {
    const pinnedRects = rects.filter(rect => {
      return tabsList.find(tab => tab.id === rect.id)?.isPinned === true
    })
    const lastPinnedRect = pinnedRects[pinnedRects.length - 1]

    if (pinnedRects[0] && lastPinnedRect) {
      minStart = pinnedRects[0].start - sourceRect.size / 2
      maxStart = lastPinnedRect.start + lastPinnedRect.size - sourceRect.size / 2
    }
  } else {
    const firstUnpinnedIndex = tabsList.findIndex(tab => tab.isPinned !== true)
    const firstUnpinnedRect = firstUnpinnedIndex >= 0 ? rects[firstUnpinnedIndex] : rects[0]

    if (firstUnpinnedRect) {
      minStart = firstUnpinnedRect.start - sourceRect.size / 2
    }
  }

  const newStart = Math.max(minStart, Math.min(maxStart, sourceRect.start + delta))
  const draggedOffset = newStart - sourceRect.start
  const draggedCenter = newStart + sourceRect.size / 2

  dragSession.draggedOffset = draggedOffset

  // Determine the target slot by comparing the dragged tab's center
  // against the centers of the other (stationary, original layout) tabs.
  let targetIndex = sourceIndex
  for (let i = 0; i < rects.length; i++) {
    if (i === sourceIndex) continue
    const center = rects[i].start + rects[i].size / 2
    if (i < sourceIndex && draggedCenter < center) {
      targetIndex = Math.min(targetIndex, i)
    } else if (i > sourceIndex && draggedCenter > center) {
      targetIndex = Math.max(targetIndex, i)
    }
  }

  targetIndex = clampTargetIndexForPinnedGroup(dragSession.tabId, targetIndex)

  dragSession.targetIndex = targetIndex

  tabOffsets.value = computeOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset)
}

/**
 * Keep drag targets in the same group the main process will enforce.
 * @param {string} tabId
 * @param {number} targetIndex
 * @returns {number}
 */
function clampTargetIndexForPinnedGroup(tabId, targetIndex) {
  const tabsList = tabs.value
  const sourceTab = tabsList.find(tab => tab.id === tabId)
  if (!sourceTab) {
    return targetIndex
  }

  const pinnedCountWithoutSource = tabsList.filter(tab => {
    return tab.id !== tabId && tab.isPinned === true
  }).length

  if (sourceTab.isPinned === true) {
    return Math.min(targetIndex, pinnedCountWithoutSource)
  }

  return Math.max(targetIndex, pinnedCountWithoutSource)
}

/**
 * Build the offset map for every tab given the proposed reorder.
 * The dragged tab gets the user's pointer offset; all other tabs animate
 * to the slot they would occupy in the reordered layout.
 * @param {Array<{id: string, start: number, size: number}>} rects
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

  let cursor = rects[0].start
  for (const idx of order) {
    const rect = rects[idx]
    if (idx === sourceIndex) {
      offsets[rect.id] = draggedOffset
    } else {
      const delta = cursor - rect.start
      if (delta !== 0) {
        offsets[rect.id] = delta
      }
    }
    cursor += rect.size + gap
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

  document.body.classList.remove('tab-bar-grabbing')

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
 * @param {Array<{id: string, start: number, size: number}>} rects
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

  let cursor = rects[0].start
  for (const idx of order) {
    if (idx === sourceIndex) {
      offsets[rects[idx].id] = cursor - rects[idx].start
      break
    }
    cursor += rects[idx].size + gap
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
async function commitReorder(tabId, sourceIndex, targetIndex) {
  if (sourceIndex !== targetIndex) {
    suppressTransitions.value = true
    const reordered = waitForTabIndex(tabId, targetIndex)
    store.dispatch('moveTab', { tabId, toIndex: targetIndex })
    await reordered
  }

  tabOffsets.value = {}
  isSettling.value = false

  nextTick(() => {
    requestAnimationFrame(() => {
      suppressTransitions.value = false
    })
  })
}

/**
 * Wait until the main-process tab state update reaches the renderer.
 * @param {string} tabId
 * @param {number} targetIndex
 * @returns {Promise<void>}
 */
function waitForTabIndex(tabId, targetIndex) {
  if (tabs.value.findIndex(tab => tab.id === tabId) === targetIndex) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let timeoutId = null
    const stop = watch(tabs, (newTabs) => {
      if (newTabs.findIndex(tab => tab.id === tabId) === targetIndex) {
        cleanup()
      }
    })

    function cleanup() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      stop()
      resolve()
    }

    timeoutId = window.setTimeout(cleanup, REORDER_STATE_UPDATE_TIMEOUT_MS)
  })
}

function handleDragPointerCancel() {
  cleanupDragListeners()
  document.body.classList.remove('tab-bar-grabbing')

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

// ===== Vertical tab bar resizing =====
const MIN_VERTICAL_TAB_BAR_WIDTH = 150
const MAX_VERTICAL_TAB_BAR_WIDTH = 400
const DEFAULT_VERTICAL_TAB_BAR_WIDTH = 220

let isResizingTabBar = false

/**
 * @param {PointerEvent} event
 */
function handleResizePointerDown(event) {
  if (event.button !== 0) return

  event.preventDefault()
  isResizingTabBar = true
  document.body.classList.add('tab-bar-resizing')
  window.addEventListener('pointermove', handleResizePointerMove)
  window.addEventListener('pointerup', handleResizePointerUp)
  window.addEventListener('pointercancel', handleResizePointerUp)
}

/**
 * @param {PointerEvent} event
 */
function handleResizePointerMove(event) {
  const bar = tabBarRef.value
  if (!bar) return

  const rect = bar.getBoundingClientRect()
  const isRtl = getComputedStyle(bar).direction === 'rtl'
  const width = isRtl ? rect.right - event.clientX : event.clientX - rect.left
  const clampedWidth = Math.round(
    Math.max(MIN_VERTICAL_TAB_BAR_WIDTH, Math.min(MAX_VERTICAL_TAB_BAR_WIDTH, width))
  )

  // Apply live via the mutation; the pointerup handler persists the result.
  store.commit('setVerticalTabBarWidth', clampedWidth)
}

function handleResizePointerUp() {
  stopTabBarResize()
  store.dispatch('updateVerticalTabBarWidth', store.getters.getVerticalTabBarWidth)
}

function stopTabBarResize() {
  if (!isResizingTabBar) return

  isResizingTabBar = false
  document.body.classList.remove('tab-bar-resizing')
  window.removeEventListener('pointermove', handleResizePointerMove)
  window.removeEventListener('pointerup', handleResizePointerUp)
  window.removeEventListener('pointercancel', handleResizePointerUp)
}

function resetTabBarWidth() {
  store.dispatch('updateVerticalTabBarWidth', DEFAULT_VERTICAL_TAB_BAR_WIDTH)
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

/**
 * Prevent the browser's middle-click scrolling mode in the empty tab-list area.
 * @param {MouseEvent} event
 */
function handleTabListMiddleMouseDown(event) {
  if (event.target === event.currentTarget) {
    event.preventDefault()
  }
}

/**
 * Create a tab when the empty tab-list area is middle-clicked.
 * @param {MouseEvent} event
 */
function handleTabListAuxClick(event) {
  if (event.button === 1 && event.target === event.currentTarget) {
    event.preventDefault()
    createNewTab()
  }
}

function createNewTab() {
  store.dispatch('createTab', { makeActive: true })
}

// ===== Context menu =====
/**
 * @param {{ tabId: string | null, surface: 'tab' | 'tabBar' | 'content' | 'subscriptionFeedTab', feedTab?: 'videos' | 'shorts' | 'live' | 'posts' | 'all' | null }} payload
 */
function updateContextMenuTab(payload) {
  window.ftElectron.tabs.setContextMenuTab({ ...payload, verticalLayout: vertical.value })
}

/**
 * @param {PointerEvent} event
 */
function handleContextMenuPointerDown(event) {
  if (!isElectron || event.button !== 2 || !(event.target instanceof Element)) {
    return
  }

  const tabId = event.target.closest('.tab[data-tab-id]')?.dataset.tabId ?? null
  const feedTab = event.target.closest('[data-subscription-feed-tab]')?.dataset.subscriptionFeedTab ?? null
  const isTabBar = event.target.closest('.tabBar') != null
  updateContextMenuTab({
    tabId,
    surface: tabId ? 'tab' : isTabBar ? 'tabBar' : feedTab ? 'subscriptionFeedTab' : 'content',
    feedTab
  })
}

/**
 * @param {MouseEvent} event
 */
function handleContextMenuEvent(event) {
  if (!isElectron || !(event.target instanceof Element)) {
    return
  }

  const tabId = event.target.closest('.tab[data-tab-id]')?.dataset.tabId ?? null
  const feedTab = event.target.closest('[data-subscription-feed-tab]')?.dataset.subscriptionFeedTab ?? null
  const isTabBar = event.target.closest('.tabBar') != null
  updateContextMenuTab({
    tabId,
    surface: tabId ? 'tab' : isTabBar ? 'tabBar' : feedTab ? 'subscriptionFeedTab' : 'content',
    feedTab
  })
}

// ===== Lifecycle =====
onMounted(() => {
  if (isElectron) {
    document.addEventListener('pointerdown', handleContextMenuPointerDown, true)
    document.addEventListener('contextmenu', handleContextMenuEvent, true)
    removeActiveChangedListener = window.ftElectron.tabs.onActiveChanged(() => {
      closeTooltipsSignal.value++
    })
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
    updateContextMenuTab({ tabId: null, surface: 'content' })
    removeActiveChangedListener?.()
    removeActiveChangedListener = null
  }

  cleanupDragListeners()
  if (settleTimeoutId != null) {
    clearTimeout(settleTimeoutId)
    settleTimeoutId = null
  }

  stopTabBarResize()
  stopScrollbarThumbDrag()
  cancelScrollAnimation()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', handleWindowResize)
  document.body.classList.remove('tab-bar-grabbing')
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
let removeActiveChangedListener = null

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

  // The vertical layout scrolls natively, so the custom scrollbar stays hidden.
  if (vertical.value) {
    showScrollbar.value = false
    scrollbarThumbWidth.value = 0
    scrollbarThumbOffset.value = 0
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
  // The vertical layout relies on the container's native vertical scrolling.
  if (vertical.value) return

  const container = dropZoneRef.value
  if (!container) return

  event.preventDefault()

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
  updateActiveDragPosition()
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
  scrollTarget = nextScrollLeft
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

  document.body.classList.add('tab-bar-grabbing')
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
  scrollTarget = clampedScrollLeft
  if (isElectron) {
    window.ftElectron.tabs.setTabBarScroll(clampedScrollLeft)
  }
  updateScrollbar()
}

function stopScrollbarThumbDrag() {
  scrollbarDragState = null
  document.body.classList.remove('tab-bar-grabbing')
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
  if (newPosition == null || vertical.value) return

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

watch(vertical, () => {
  cancelScrollAnimation()
  scrollTarget = null
  nextTick(() => {
    updateScrollbar()
  })
})
</script>

<style scoped src="./TabBar.css" />

<style>
body.tab-bar-grabbing,
body.tab-bar-grabbing * {
  cursor: grabbing !important;
  user-select: none !important;
}

body.tab-bar-resizing,
body.tab-bar-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
</style>
