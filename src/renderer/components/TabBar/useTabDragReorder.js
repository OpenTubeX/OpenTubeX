import { nextTick, ref, watch } from 'vue'

import store from '../../store/index'
import { computeReorderOffsets } from '../../helpers/reorderOffsets'
import {
  buildCurrentShiftedTabIds,
  buildShiftedTabIds,
  getDraggedTabIds,
  getTabIndexShift
} from './tabReorder'

const DRAG_THRESHOLD_PX = 5
const DRAG_AUTO_SCROLL_EDGE_PX = 48
const DRAG_AUTO_SCROLL_PX_PER_MS = 0.6
// Follow wall-clock time on slow frames, but limit the jump after a stall.
const DRAG_AUTO_SCROLL_MAX_FRAME_MS = 100
const SETTLE_DURATION_MS = 180
const REORDER_STATE_UPDATE_TIMEOUT_MS = 300

/**
 * Drag positions are measured along the tab bar's main axis:
 * horizontal (clientX/scrollLeft) normally, vertical (clientY/scrollTop)
 * when the vertical tab bar layout is enabled.
 * @typedef {object} DragSession
 * @property {string} tabId
 * @property {string[]} tabIds
 * @property {Set<string>} draggedTabIdSet
 * @property {Array<{id: string, isPinned?: boolean}>} tabs
 * @property {number} sourceIndex
 * @property {number} indexShift
 * @property {string[]} reorderedTabIds
 * @property {number} pointerStart
 * @property {number} pointerCurrent
 * @property {number} scrollStart
 * @property {number} viewportStart
 * @property {number} viewportEnd
 * @property {Array<{id: string, start: number, size: number}>} rects
 * @property {number} gap
 * @property {number} groupStartIndex
 * @property {number} groupEndIndex
 * @property {number} minOffset
 * @property {number} maxOffset
 * @property {Record<string, number>} neighborOffsets
 * @property {number | null} renderedOffset
 * @property {boolean} started
 * @property {boolean} moved
 * @property {number} draggedOffset
 * @property {number} draggedSize
 * @property {boolean} deferPositionUpdates
 */

/**
 * @param {{start: number, size: number}} first
 * @param {{start: number, size: number}} last
 * @returns {[number, number]} the start and end of the span both rects cover
 * in either text direction
 */
function getRectSpan(first, last) {
  return [
    Math.min(first.start, last.start),
    Math.max(first.start + first.size, last.start + last.size)
  ]
}

/**
 * Pointer drag reordering for the tab bar strip: dragging the selected tabs,
 * auto-scrolling near the ends, then settling into their new slot before the
 * order is committed to the store.
 *
 * @param {{
 *   vertical: import('vue').Ref<boolean>,
 *   tabs: import('vue').ComputedRef<Array<{id: string, isPinned?: boolean}>>,
 *   stripItems: import('vue').ComputedRef<Array<{id: string, isPinned?: boolean, tabIds?: string[]}>>,
 *   selectedTabIds: import('vue').ComputedRef<Set<string>>,
 *   closeTooltipsSignal: import('vue').Ref<number>,
 *   dropZoneRef: import('vue').ShallowRef<HTMLElement | null>,
 *   buildStripItems: (tabs: Array<object>) => Array<{id: string, isPinned?: boolean}>,
 *   clearTabSelection: () => void,
 *   setTabSelection: (tabIds: string[]) => void,
 *   setSelectionAnchor: (tabId: string) => void,
 *   cancelScrollAnimation: () => void
 * }} options
 */
export function useTabDragReorder({
  vertical,
  tabs,
  stripItems,
  selectedTabIds,
  closeTooltipsSignal,
  dropZoneRef,
  buildStripItems,
  clearTabSelection,
  setTabSelection,
  setSelectionAnchor,
  cancelScrollAnimation
}) {
  /** @type {import('vue').Ref<Set<string>>} */
  const draggingTabIds = ref(new Set())
  /** @type {import('vue').Ref<Set<string>>} */
  const settlingTabIds = ref(new Set())
  /** @type {import('vue').Ref<Record<string, number>>} */
  const tabOffsets = ref({})
  const isSettling = ref(false)
  const suppressTransitions = ref(false)

  /** @type {DragSession | null} */
  let dragSession = null
  let dragAnimationFrameId = null
  let dragAutoScrollFrameId = null
  let settleTimeoutId = null
  /** @type {{tabIds: string[], indexShift: number, isPinned: boolean} | null} */
  let pendingSettleReorder = null

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

    if (target.closest('.os-scrollbar')) {
      cancelScrollAnimation()
      return
    }

    // Ignore clicks on the close button
    if (target.closest('.closeButton')) return

    const reorderItemEl = target.closest('.tabBarReorderItem[data-reorder-id]')
    if (!(reorderItemEl instanceof HTMLElement)) {
      clearTabSelection()
      return
    }

    const interruptedSettle = isSettling.value
    const pendingTabOrder = finishSettle(true)

    const container = dropZoneRef.value
    if (!container) return

    const tabId = reorderItemEl.dataset.reorderId
    const currentTabs = tabs.value
    const currentTabsById = new Map(currentTabs.map(tab => [tab.id, tab]))
    const orderedTabs = pendingTabOrder
      ? pendingTabOrder.map(tabId => currentTabsById.get(tabId)).filter(Boolean)
      : currentTabs
    const tabsList = buildStripItems(orderedTabs)
    const sourceIndex = tabsList.findIndex(t => t.id === tabId)
    if (sourceIndex === -1) return
    const tabIds = getDraggedTabIds(tabsList, selectedTabIds.value, tabId)

    const tabEls = Array.from(container.querySelectorAll('.tabBarReorderItem[data-reorder-id]'))
    if (tabEls.length === 0) return

    const containerRect = container.getBoundingClientRect()
    const containerScroll = containerScrollPosition(container)

    // Layout start = position within the scrollable content (so it stays
    // consistent regardless of the current scroll offset).
    const measuredRects = tabEls.map(el => {
      const rect = el.getBoundingClientRect()
      return {
        id: el.dataset.reorderId,
        start: (vertical.value ? rect.top - containerRect.top : rect.left - containerRect.left) + containerScroll,
        size: vertical.value ? rect.height : rect.width
      }
    })
    const measuredRectById = new Map(measuredRects.map(rect => [rect.id, rect]))
    const rects = tabsList.map(tab => measuredRectById.get(tab.id)).filter(Boolean)
    if (rects.length !== tabsList.length) return

    // Compute the gap between adjacent tabs (matches the .tabsContent gap)
    let gap = 0
    if (rects.length > 1) {
      gap = rects[1].start - (rects[0].start + rects[0].size)
    }

    const draggedTabIdSet = new Set(tabIds)
    const draggedRects = rects.filter(rect => draggedTabIdSet.has(rect.id))
    const pinnedCount = tabsList.filter(tab => tab.isPinned === true).length
    const isSourcePinned = tabsList[sourceIndex].isPinned === true
    const groupStartIndex = isSourcePinned ? 0 : pinnedCount
    const groupEndIndex = isSourcePinned ? pinnedCount - 1 : tabsList.length - 1
    const firstDraggedRect = draggedRects[0]
    const lastDraggedRect = draggedRects[draggedRects.length - 1]
    const [draggedStart, draggedEnd] = getRectSpan(firstDraggedRect, lastDraggedRect)

    dragSession = {
      tabId,
      tabIds,
      draggedTabIdSet,
      tabs: tabsList.map(tab => ({ id: tab.id, isPinned: tab.isPinned })),
      sourceIndex,
      indexShift: 0,
      reorderedTabIds: tabsList.map(tab => tab.id),
      pointerStart: pointerAxisPosition(event),
      pointerCurrent: pointerAxisPosition(event),
      scrollStart: containerScroll,
      viewportStart: vertical.value ? containerRect.top : containerRect.left,
      viewportEnd: vertical.value ? containerRect.bottom : containerRect.right,
      rects,
      gap,
      groupStartIndex,
      groupEndIndex,
      minOffset: rects[groupStartIndex].start - firstDraggedRect.start,
      maxOffset: rects[groupEndIndex].start + rects[groupEndIndex].size -
        lastDraggedRect.start - lastDraggedRect.size,
      neighborOffsets: {},
      renderedOffset: null,
      started: false,
      moved: false,
      draggedOffset: 0,
      draggedSize: draggedEnd - draggedStart,
      deferPositionUpdates: interruptedSettle
    }
    const currentDragSession = dragSession

    window.addEventListener('pointermove', handleDragPointerMove)
    window.addEventListener('pointerup', handleDragPointerUp)
    window.addEventListener('pointercancel', handleDragPointerCancel)

    if (interruptedSettle) {
      resumeDragAfterSettle(currentDragSession)
    }
  }

  /**
   * Let the interrupted reorder render once without transitions before applying
   * offsets from the new drag. Otherwise the old layout swap and new transform
   * animation are combined into one frame and neighboring tabs jump.
   * @param {DragSession} session
   */
  function resumeDragAfterSettle(session) {
    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (dragSession !== session) {
            if (!dragSession?.deferPositionUpdates) {
              suppressTransitions.value = false
            }
            return
          }

          session.deferPositionUpdates = false
          suppressTransitions.value = false
          updateActiveDragPosition()
        })
      })
    })
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
      if (
        !selectedTabIds.value.has(dragSession.tabId) ||
        selectedTabIds.value.size !== dragSession.tabIds.length
      ) {
        setTabSelection(dragSession.tabIds.length > 1 ? dragSession.tabIds : [])
        setSelectionAnchor(dragSession.tabId)
      }
      draggingTabIds.value = new Set(dragSession.tabIds)
      closeTooltipsSignal.value++
      document.body.classList.add('tab-bar-grabbing')
    }

    dragSession.moved = true
    // Prevent text selection while dragging
    event.preventDefault()

    scheduleDragPositionUpdate()
    startDragAutoScroll()
  }

  /**
   * Scroll the tab list while the pointer is held near or past either end, so
   * the dragged tabs can reach positions outside the visible range. The scroll
   * handler then moves the dragged tabs along with the list.
   */
  function startDragAutoScroll() {
    if (dragAutoScrollFrameId != null || getDragAutoScrollSpeed() === 0) return

    let previousTime = performance.now()
    const scroll = (time) => {
      const speed = getDragAutoScrollSpeed()
      const container = dropZoneRef.value
      if (speed === 0 || !container) {
        dragAutoScrollFrameId = null
        return
      }

      const elapsed = Math.max(0, Math.min(time - previousTime, DRAG_AUTO_SCROLL_MAX_FRAME_MS))
      const step = speed * DRAG_AUTO_SCROLL_PX_PER_MS * elapsed
      previousTime = time
      if (vertical.value) {
        container.scrollTop += step
      } else {
        // Only the horizontal layout animates wheel scrolling toward a target.
        cancelScrollAnimation()
        container.scrollLeft += step
      }
      dragAutoScrollFrameId = requestAnimationFrame(scroll)
    }
    dragAutoScrollFrameId = requestAnimationFrame(scroll)
  }

  /**
   * @returns {number} -1 toward the start to 1 toward the end, growing as the
   * pointer nears or passes that edge
   */
  function getDragAutoScrollSpeed() {
    const container = dropZoneRef.value
    if (!dragSession?.started || !container) return 0

    const {
      pointerCurrent, viewportStart, viewportEnd,
      rects, groupStartIndex, groupEndIndex, draggedSize
    } = dragSession
    const viewportSize = viewportEnd - viewportStart
    const edge = Math.min(DRAG_AUTO_SCROLL_EDGE_PX, viewportSize / 4)
    const scroll = containerScrollPosition(container)
    const [listStart, listEnd] = getRectSpan(rects[0], rects[rects.length - 1])
    const [groupStart, groupEnd] = getRectSpan(rects[groupStartIndex], rects[groupEndIndex])
    // Scroll to that end of the list, past the other pin group, if the dragged
    // tabs held at their group's boundary stay in view there. Otherwise stop
    // once that boundary is visible, since they cannot move past it.
    if (pointerCurrent < viewportStart + edge) {
      const target = groupStart + draggedSize <= listStart + viewportSize ? listStart : groupStart
      return target < scroll
        ? -Math.min(1, (viewportStart + edge - pointerCurrent) / edge)
        : 0
    }
    const target = groupEnd - draggedSize >= listEnd - viewportSize ? listEnd : groupEnd
    return target > scroll + viewportSize
      ? Math.max(0, Math.min(1, (pointerCurrent - viewportEnd + edge) / edge))
      : 0
  }

  function scheduleDragPositionUpdate() {
    if (!dragSession?.started || dragAnimationFrameId != null) return

    dragAnimationFrameId = requestAnimationFrame(() => {
      dragAnimationFrameId = null
      updateActiveDragPosition(!dragSession?.deferPositionUpdates)
    })
  }

  /**
   * @param {boolean} [updateVisuals]
   */
  function updateActiveDragPosition(updateVisuals = true) {
    if (!dragSession || !dragSession.started) return

    const container = dropZoneRef.value
    if (!container) return

    const delta = dragSession.pointerCurrent -
      dragSession.pointerStart +
      containerScrollPosition(container) -
      dragSession.scrollStart

    const {
      rects, sourceIndex, gap, draggedTabIdSet,
      groupStartIndex, groupEndIndex, minOffset, maxOffset
    } = dragSession
    const sourceRect = rects[sourceIndex]
    const draggedOffset = Math.max(minOffset, Math.min(maxOffset, delta))
    const intendedDraggedCenter = sourceRect.start + delta + sourceRect.size / 2

    dragSession.draggedOffset = draggedOffset

    const indexShift = getTabIndexShift(
      rects,
      draggedTabIdSet,
      sourceIndex,
      intendedDraggedCenter,
      groupStartIndex,
      groupEndIndex
    )
    // Neighbor positions only change when the target slot changes. Keep the
    // pointer's continuous movement out of the full-order calculations.
    if (indexShift !== dragSession.indexShift) {
      const reorderedTabIds = buildShiftedTabIds(
        dragSession.tabs.map(tab => tab.id),
        dragSession.tabIds,
        indexShift
      )
      dragSession.indexShift = indexShift
      dragSession.reorderedTabIds = reorderedTabIds
      dragSession.neighborOffsets = computeReorderOffsets(
        rects,
        reorderedTabIds,
        gap,
        draggedTabIdSet
      )
      dragSession.renderedOffset = null
    }
    if (updateVisuals && dragSession.renderedOffset !== draggedOffset) {
      const offsets = { ...dragSession.neighborOffsets }
      for (const tabId of dragSession.tabIds) {
        offsets[tabId] = draggedOffset
      }
      tabOffsets.value = offsets
      dragSession.renderedOffset = draggedOffset
    }
  }

  function handleDragPointerUp() {
    cleanupDragListeners()

    if (!dragSession) return

    // A release can arrive before the scheduled frame. Settle into the slot
    // selected by the latest pointer and scroll positions.
    updateActiveDragPosition(false)

    const {
      started,
      moved,
      tabIds,
      tabs: tabsSnapshot,
      indexShift,
      rects,
      gap,
      reorderedTabIds
    } = dragSession

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
    const snapOffsets = computeReorderOffsets(rects, reorderedTabIds, gap)

    tabOffsets.value = snapOffsets
    draggingTabIds.value = new Set()
    settlingTabIds.value = new Set(tabIds)
    isSettling.value = true

    const sourceTab = tabsSnapshot.find(tab => tab.id === dragSession.tabId)
    pendingSettleReorder = {
      tabIds,
      indexShift,
      isPinned: sourceTab?.isPinned === true
    }
    settleTimeoutId = window.setTimeout(() => {
      settleTimeoutId = null
      const pendingReorder = pendingSettleReorder
      pendingSettleReorder = null
      if (pendingReorder) {
        commitReorder(pendingReorder)
      }
    }, SETTLE_DURATION_MS)

    dragSession = null
  }

  /**
   * Commit the reorder to the store, then reset transforms without animating
   * (so the elements don't jump from their offset positions back to 0).
   * @param {{tabIds: string[], indexShift: number, isPinned: boolean}} pendingReorder
   * @param {boolean} [cleanupVisuals]
   */
  async function commitReorder(pendingReorder, cleanupVisuals = true) {
    const reorderedItemIds = buildCurrentShiftedTabIds(
      stripItems.value,
      pendingReorder.tabIds,
      pendingReorder.indexShift,
      pendingReorder.isPinned
    )
    const reorderedTabIds = expandStripOrder(reorderedItemIds)
    if (!tabOrderMatches(reorderedTabIds)) {
      suppressTransitions.value = true
      const reordered = waitForTabOrder(reorderedTabIds)
      store.dispatch('reorderTabs', reorderedTabIds)
      await reordered
    }

    if (cleanupVisuals) {
      tabOffsets.value = {}
      isSettling.value = false
      settlingTabIds.value = new Set()
    }

    nextTick(() => {
      requestAnimationFrame(() => {
        if (!dragSession?.deferPositionUpdates) {
          suppressTransitions.value = false
        }
      })
    })
  }

  /**
   * Expand visible strip items back into the complete tab order. A group may
   * contain both pinned and unpinned tabs, so retain the visible order within
   * each pin partition and then restore the required pinned boundary.
   * @param {string[]} itemIds
   * @returns {string[]}
   */
  function expandStripOrder(itemIds) {
    const itemById = new Map(stripItems.value.map(item => [item.id, item]))
    const tabById = new Map(tabs.value.map(tab => [tab.id, tab]))
    const expandedIds = itemIds.flatMap(itemId => itemById.get(itemId)?.tabIds ?? [])
    return [true, false].flatMap(isPinned => (
      expandedIds.filter(tabId => (tabById.get(tabId)?.isPinned === true) === isPinned)
    ))
  }

  /**
   * Wait until the main-process tab state update reaches the renderer.
   * @param {string[]} tabIds
   * @returns {Promise<void>}
   */
  function waitForTabOrder(tabIds) {
    if (tabOrderMatches(tabIds)) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      let timeoutId = null
      const stop = watch(tabs, (newTabs) => {
        if (newTabs.map(tab => tab.id).every((tabId, index) => tabId === tabIds[index])) {
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

  /**
   * @param {string[]} tabIds
   * @returns {boolean}
   */
  function tabOrderMatches(tabIds) {
    return tabs.value.length === tabIds.length &&
      tabs.value.every((tab, index) => tab.id === tabIds[index])
  }

  function handleDragPointerCancel() {
    cleanupDragListeners()
    document.body.classList.remove('tab-bar-grabbing')

    if (!dragSession) return

    if (dragSession.started) {
      // Animate the dragged tab back to its slot; other offsets are already
      // shifted toward the proposed target, so animate them back to 0 too.
      tabOffsets.value = {}
      draggingTabIds.value = new Set()
      settlingTabIds.value = new Set(dragSession.tabIds)
      isSettling.value = true

      settleTimeoutId = window.setTimeout(() => {
        settleTimeoutId = null
        isSettling.value = false
        settlingTabIds.value = new Set()
      }, SETTLE_DURATION_MS)
    }

    dragSession = null
  }

  function cleanupDragListeners() {
    if (dragAnimationFrameId != null) {
      cancelAnimationFrame(dragAnimationFrameId)
      dragAnimationFrameId = null
    }
    if (dragAutoScrollFrameId != null) {
      cancelAnimationFrame(dragAutoScrollFrameId)
      dragAutoScrollFrameId = null
    }
    window.removeEventListener('pointermove', handleDragPointerMove)
    window.removeEventListener('pointerup', handleDragPointerUp)
    window.removeEventListener('pointercancel', handleDragPointerCancel)
  }

  /**
   * If a settle animation is currently in progress, finish it immediately so a
   * new drag starts from a clean state.
   * @param {boolean} cancel
   * @returns {string[] | null}
   */
  function finishSettle(cancel) {
    if (settleTimeoutId != null) {
      clearTimeout(settleTimeoutId)
      settleTimeoutId = null
    }
    const pendingReorder = pendingSettleReorder
    pendingSettleReorder = null
    const pendingTabOrder = pendingReorder
      ? expandStripOrder(buildCurrentShiftedTabIds(
          stripItems.value,
          pendingReorder.tabIds,
          pendingReorder.indexShift,
          pendingReorder.isPinned
        ))
      : null
    if (cancel) {
      suppressTransitions.value = true
      tabOffsets.value = {}
      isSettling.value = false
      settlingTabIds.value = new Set()
      if (!pendingReorder) {
        nextTick(() => {
          requestAnimationFrame(() => {
            if (!dragSession?.deferPositionUpdates) {
              suppressTransitions.value = false
            }
          })
        })
      }
    }
    if (pendingReorder) {
      commitReorder(pendingReorder, !cancel)
    }
    return pendingTabOrder
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

  /**
   * Drop the listeners, timers and pending reorder of a drag or settle that is
   * still in progress when the tab bar unmounts.
   */
  function disposeTabDrag() {
    cleanupDragListeners()
    if (settleTimeoutId != null) {
      clearTimeout(settleTimeoutId)
      settleTimeoutId = null
    }
    pendingSettleReorder = null
  }

  return {
    draggingTabIds,
    settlingTabIds,
    tabOffsets,
    isSettling,
    suppressTransitions,
    handleTabContainerPointerDown,
    scheduleDragPositionUpdate,
    disposeTabDrag
  }
}
