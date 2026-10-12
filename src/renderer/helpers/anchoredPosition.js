export const supportsAnchorPositioning = CSS.supports('position-anchor', '--popup')

/**
 * Keep measured placement and viewport limits while CSS follows the trigger.
 * Browsers without anchors retain the measured, fixed coordinates.
 * @param {string} anchor
 * @param {DOMRect} triggerRect
 * @param {number} left
 * @param {number} top
 * @param {{minLeft: number, maxLeft: number, minTop: number, maxTop: number}} [limits]
 * @returns {{positionAnchor: string|null, left: string, top: string}}
 */
export function getAnchoredPosition(anchor, triggerRect, left, top, limits) {
  if (limits) {
    left = Math.max(limits.minLeft, Math.min(left, limits.maxLeft))
    top = Math.max(limits.minTop, Math.min(top, limits.maxTop))
  }
  if (!supportsAnchorPositioning) {
    return { positionAnchor: null, left: `${left}px`, top: `${top}px` }
  }

  const anchoredLeft = `calc(anchor(left) + ${left - triggerRect.left}px)`
  const anchoredTop = `calc(anchor(top) + ${top - triggerRect.top}px)`
  return {
    positionAnchor: anchor,
    left: limits ? `clamp(${limits.minLeft}px, ${anchoredLeft}, ${limits.maxLeft}px)` : anchoredLeft,
    top: limits ? `clamp(${limits.minTop}px, ${anchoredTop}, ${limits.maxTop}px)` : anchoredTop
  }
}
