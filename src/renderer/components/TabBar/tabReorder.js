/**
 * Return the tabs that should move when a drag starts. A mixed pinned and
 * unpinned selection is split because those groups cannot cross each other.
 * @param {Array<{id: string, isPinned?: boolean}>} tabs
 * @param {Set<string>} selectedTabIds
 * @param {string} sourceTabId
 * @returns {string[]}
 */
export function getDraggedTabIds(tabs, selectedTabIds, sourceTabId) {
  if (!selectedTabIds.has(sourceTabId) || selectedTabIds.size < 2) {
    return [sourceTabId]
  }

  const sourceIsPinned = tabs.find(tab => tab.id === sourceTabId)?.isPinned === true
  return tabs
    .filter(tab => selectedTabIds.has(tab.id) && (tab.isPinned === true) === sourceIsPinned)
    .map(tab => tab.id)
}

/**
 * Build the tab order produced by shifting every dragged tab by the same
 * number of positions. Selected tabs keep the spacing between them.
 * @param {string[]} tabIds
 * @param {string[]} draggedTabIds
 * @param {number} indexShift
 * @returns {string[]}
 */
export function buildShiftedTabIds(tabIds, draggedTabIds, indexShift) {
  const draggedSet = new Set(draggedTabIds)
  const remainingTabIds = tabIds.filter(tabId => !draggedSet.has(tabId))
  const targetIndexes = new Set(
    tabIds
      .map((tabId, index) => draggedSet.has(tabId) ? index + indexShift : null)
      .filter(index => index != null)
  )
  let draggedIndex = 0
  let remainingIndex = 0

  return tabIds.map((_, index) => {
    if (targetIndexes.has(index)) {
      return draggedTabIds[draggedIndex++]
    }
    return remainingTabIds[remainingIndex++]
  })
}

/**
 * Rebuild a pending drag against the current tab set. Tabs opened or closed
 * during the settle animation remain present and the shift is clamped again
 * to the current pinned or unpinned group.
 * @param {Array<{id: string, isPinned?: boolean}>} tabs
 * @param {string[]} draggedTabIds
 * @param {number} indexShift
 * @param {boolean} isPinned
 * @returns {string[]}
 */
export function buildCurrentShiftedTabIds(tabs, draggedTabIds, indexShift, isPinned) {
  const tabIds = tabs.map(tab => tab.id)
  const draggedTabIdSet = new Set(draggedTabIds)
  const currentDraggedTabIds = tabs
    .filter(tab => {
      return draggedTabIdSet.has(tab.id) && (tab.isPinned === true) === isPinned
    })
    .map(tab => tab.id)
  if (currentDraggedTabIds.length === 0) {
    return tabIds
  }

  const draggedIndexes = currentDraggedTabIds.map(tabId => tabIds.indexOf(tabId))
  const pinnedCount = tabs.filter(tab => tab.isPinned === true).length
  const groupStartIndex = isPinned ? 0 : pinnedCount
  const groupEndIndex = isPinned ? pinnedCount - 1 : tabs.length - 1
  const minShift = groupStartIndex - Math.min(...draggedIndexes)
  const maxShift = groupEndIndex - Math.max(...draggedIndexes)
  const clampedShift = Math.max(minShift, Math.min(maxShift, indexShift))

  return buildShiftedTabIds(tabIds, currentDraggedTabIds, clampedShift)
}

/**
 * Convert the source tab's dragged center into a shared positional shift for
 * all dragged tabs, retaining their spacing and the pinned boundary.
 * @param {Array<{id: string, start: number, size: number}>} rects
 * @param {Set<string>} draggedTabIds
 * @param {number} sourceIndex
 * @param {number} draggedCenter
 * @param {number} groupStartIndex
 * @param {number} groupEndIndex
 * @returns {number}
 */
export function getTabIndexShift(
  rects,
  draggedTabIds,
  sourceIndex,
  draggedCenter,
  groupStartIndex,
  groupEndIndex
) {
  let targetIndex = sourceIndex
  for (let index = groupStartIndex; index <= groupEndIndex; index++) {
    if (index === sourceIndex) continue
    const center = rects[index].start + rects[index].size / 2
    if (index < sourceIndex && draggedCenter <= center) {
      targetIndex = Math.min(targetIndex, index)
    } else if (index > sourceIndex && draggedCenter >= center) {
      targetIndex = Math.max(targetIndex, index)
    }
  }

  const draggedIndexes = rects
    .map((rect, index) => draggedTabIds.has(rect.id) ? index : null)
    .filter(index => index != null)
  const minShift = groupStartIndex - Math.min(...draggedIndexes)
  const maxShift = groupEndIndex - Math.max(...draggedIndexes)
  return Math.max(minShift, Math.min(maxShift, targetIndex - sourceIndex))
}

/**
 * Calculate transforms that visually place tabs in a proposed order.
 * @param {Array<{id: string, start: number, size: number}>} rects
 * @param {string[]} reorderedTabIds
 * @param {number} gap
 * @param {Set<string>} freelyMovingTabIds
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
export function computeTabOffsets(
  rects,
  reorderedTabIds,
  gap,
  freelyMovingTabIds = new Set(),
  draggedOffset = 0
) {
  const offsets = {}
  const rectById = new Map(rects.map(rect => [rect.id, rect]))
  let cursor = rects[0]?.start ?? 0

  for (const tabId of reorderedTabIds) {
    const rect = rectById.get(tabId)
    if (!rect) continue

    const offset = freelyMovingTabIds.has(tabId)
      ? draggedOffset
      : cursor - rect.start
    if (offset !== 0) {
      offsets[tabId] = offset
    }
    cursor += rect.size + gap
  }

  return offsets
}
