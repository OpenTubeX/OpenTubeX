export const supportsAnchorPositioning = CSS.supports('position-anchor', '--popup')

/**
 * Firefox resolves anchor() as if the anchor's scroll containers were
 * unscrolled and subtracts their offset from the whole value, so clamp() limits
 * the wrong position once the page is scrolled. There the measured position is
 * clamped instead, and useAnchoredViewportBounds keeps the popup inside the
 * viewport afterwards.
 */
const clampsScrolledAnchors = supportsAnchorPositioning && (() => {
  const scroller = document.createElement('div')
  scroller.style.cssText = 'position: fixed; inset: 0 auto auto 0; inline-size: 1px; block-size: 1px; overflow: hidden; visibility: hidden'
  const anchor = document.createElement('div')
  anchor.style.cssText = 'margin-block-start: 100px; block-size: 1px; anchor-name: --anchor-scroll-probe'
  const popup = document.createElement('div')
  popup.style.cssText = 'position: fixed; position-anchor: --anchor-scroll-probe; top: clamp(-100px, anchor(top), 50px); visibility: hidden'
  scroller.append(anchor)
  document.documentElement.append(scroller)
  scroller.scrollTop = 100
  document.documentElement.append(popup)
  const clamped = Math.abs(popup.getBoundingClientRect().top - anchor.getBoundingClientRect().top) < 1
  scroller.remove()
  popup.remove()
  return clamped
})()

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
  if (limits && !clampsScrolledAnchors) {
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
    left: limits && clampsScrolledAnchors ? `clamp(${limits.minLeft}px, ${anchoredLeft}, ${limits.maxLeft}px)` : anchoredLeft,
    top: limits && clampsScrolledAnchors ? `clamp(${limits.minTop}px, ${anchoredTop}, ${limits.maxTop}px)` : anchoredTop,
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
