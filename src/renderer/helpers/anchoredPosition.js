export const supportsAnchorPositioning = CSS.supports('position-anchor', '--popup')

/**
 * Keep measured placement and viewport limits while CSS follows the trigger.
 * Browsers without anchors retain the measured, fixed coordinates.
 * @param {string} anchor
 * @param {DOMRect} triggerRect
 * @param {number} left
 * @param {number} top
 * @param {{minLeft: number, maxLeft: number, minTop: number, maxTop: number}} [limits]
 * @param {{above: boolean, gap: number, bottomMargin: number}} [placement]
 * @returns {Record<string, string|null>}
 */
export function getAnchoredPosition(anchor, triggerRect, left, top, limits, placement) {
  if (!supportsAnchorPositioning) {
    if (limits) {
      left = Math.max(limits.minLeft, Math.min(left, limits.maxLeft))
      top = Math.max(limits.minTop, Math.min(top, limits.maxTop))
    }
    return { positionAnchor: null, left: `${left}px`, top: `${top}px` }
  }

  const anchoredLeft = `calc(anchor(left) + ${left - triggerRect.left}px)`
  const anchoredTop = `calc(anchor(top) + ${top - triggerRect.top}px)`
  return {
    positionAnchor: anchor,
    translate: null,
    bottom: null,
    marginTop: null,
    marginBottom: null,
    positionTryFallbacks: null,
    '--anchor-gap': null,
    '--anchor-bottom-margin': null,
    ...(limits
      ? {
          '--anchor-min-left': `${limits.minLeft}px`,
          '--anchor-max-left': `${limits.maxLeft}px`,
          '--anchor-min-top': `${limits.minTop}px`,
          '--anchor-max-top': `${limits.maxTop}px`
        }
      : {}),
    left: limits ? `clamp(${limits.minLeft}px, ${anchoredLeft}, ${limits.maxLeft}px)` : anchoredLeft,
    top: limits ? `clamp(${limits.minTop}px, ${anchoredTop}, ${limits.maxTop}px)` : anchoredTop,
    ...(placement && limits
      ? {
          '--anchor-gap': `${placement.gap}px`,
          '--anchor-bottom-margin': `${placement.bottomMargin}px`,
          marginTop: 'var(--anchor-min-top)',
          marginBottom: 'var(--anchor-bottom-margin)',
          top: placement.above ? 'auto' : 'calc(anchor(bottom) + var(--anchor-gap) - var(--anchor-min-top))',
          bottom: placement.above ? 'calc(anchor(top) + var(--anchor-gap) - var(--anchor-bottom-margin))' : 'auto',
          positionTryFallbacks: placement.above ? '--anchored-popup-below' : '--anchored-popup-above'
        }
      : {})
  }
}
