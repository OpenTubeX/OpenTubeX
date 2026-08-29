const DEFAULT_CONTROL_SIZE = 44
const DEFAULT_CONTROL_GAP = 8

/**
 * Calculates how many cards fit without relying on rounded layout properties.
 *
 * @param {number} containerWidth
 * @param {number} itemCount
 * @param {number} itemMinWidth
 * @param {number} itemGap
 * @returns {{ pageSize: number, showControls: boolean }}
 */
export function getHomeShelfLayout(containerWidth, itemCount, itemMinWidth, itemGap) {
  const normalizedItemCount = Math.max(0, Math.floor(itemCount))

  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return {
      pageSize: Math.max(1, normalizedItemCount),
      showControls: false,
    }
  }

  const fullWidthCapacity = getCapacity(containerWidth, itemMinWidth, itemGap)
  if (normalizedItemCount <= fullWidthCapacity) {
    return {
      pageSize: Math.max(1, normalizedItemCount),
      showControls: false,
    }
  }

  const pageWidth = containerWidth - 2 * DEFAULT_CONTROL_SIZE - 2 * DEFAULT_CONTROL_GAP
  return {
    pageSize: getCapacity(pageWidth, itemMinWidth, itemGap),
    showControls: true,
  }
}

function getCapacity(width, itemMinWidth, itemGap) {
  return Math.max(1, Math.floor((width + itemGap) / (itemMinWidth + itemGap)))
}
