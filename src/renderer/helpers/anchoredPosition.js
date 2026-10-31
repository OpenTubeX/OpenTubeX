export const supportsAnchorPositioning = CSS.supports('position-anchor', '--popup')

/**
 * Firefox resolves anchor() against the anchor's untransformed box, as if its
 * scroll containers were unscrolled, and subtracts their scroll offset from the
 * whole value afterwards. Offsets from the rendered trigger then miss by any
 * ancestor transform, such as the settings window's translate, and clamp()
 * limits the wrong position once the page is scrolled. There the offsets start
 * where anchor() resolves, the position is clamped when it is measured, and
 * useAnchoredViewportBounds keeps the popup inside the viewport afterwards.
 */
const anchorsMatchRenderedBoxes = supportsAnchorPositioning && (() => {
  const scroller = document.createElement('div')
  scroller.style.cssText = 'position: fixed; inset: 0 auto auto 0; translate: 0 20px; inline-size: 1px; block-size: 1px; overflow: hidden; visibility: hidden'
  const anchor = document.createElement('div')
  anchor.style.cssText = 'margin-block-start: 100px; block-size: 1px; anchor-name: --anchor-box-probe'
  const popup = document.createElement('div')
  popup.style.cssText = 'position: fixed; position-anchor: --anchor-box-probe; top: clamp(-100px, anchor(top), 50px); visibility: hidden'
  scroller.append(anchor)
  document.documentElement.append(scroller)
  scroller.scrollTop = 100
  document.documentElement.append(popup)
  const matches = Math.abs(popup.getBoundingClientRect().top - anchor.getBoundingClientRect().top) < 1
  scroller.remove()
  popup.remove()
  return matches
})()

/**
 * @param {string} anchor
 * @returns {DOMRect} where anchor(left) and anchor(top) place a fixed popup
 */
function measureAnchorBox(anchor) {
  const probe = document.createElement('div')
  probe.style.cssText = 'position: fixed; left: anchor(left); top: anchor(top); visibility: hidden'
  probe.style.positionAnchor = anchor
  ;(document.fullscreenElement ?? document.body).append(probe)
  const rect = probe.getBoundingClientRect()
  probe.remove()
  return rect
}

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
  if (limits && !anchorsMatchRenderedBoxes) {
    left = Math.max(limits.minLeft, Math.min(left, limits.maxLeft))
    top = Math.max(limits.minTop, Math.min(top, limits.maxTop))
  }
  if (!supportsAnchorPositioning) {
    return { positionAnchor: null, left: `${left}px`, top: `${top}px` }
  }

  const anchorBox = anchorsMatchRenderedBoxes ? triggerRect : measureAnchorBox(anchor)
  const anchoredLeft = `calc(anchor(left) + ${left - anchorBox.left}px)`
  const anchoredTop = `calc(anchor(top) + ${top - anchorBox.top}px)`
  return {
    positionAnchor: anchor,
    bottom: null,
    marginTop: null,
    marginBottom: null,
    positionTryFallbacks: null,
    '--anchor-gap': null,
    '--anchor-bottom-margin': null,
    '--anchor-shift-y': null,
    ...(limits
      ? {
          '--anchor-min-left': `${limits.minLeft}px`,
          '--anchor-max-left': `${limits.maxLeft}px`,
          '--anchor-min-top': `${limits.minTop}px`,
          '--anchor-max-top': `${limits.maxTop}px`
        }
      : {}),
    left: limits && anchorsMatchRenderedBoxes ? `clamp(${limits.minLeft}px, ${anchoredLeft}, ${limits.maxLeft}px)` : anchoredLeft,
    top: limits && anchorsMatchRenderedBoxes ? `clamp(${limits.minTop}px, ${anchoredTop}, ${limits.maxTop}px)` : anchoredTop,
    ...(placement && limits
      ? {
          '--anchor-gap': `${placement.gap}px`,
          '--anchor-bottom-margin': `${placement.bottomMargin}px`,
          '--anchor-shift-y': `${triggerRect.top - anchorBox.top}px`,
          marginTop: 'var(--anchor-min-top)',
          marginBottom: 'var(--anchor-bottom-margin)',
          top: placement.above ? 'auto' : 'calc(anchor(bottom) + var(--anchor-gap) - var(--anchor-min-top) + var(--anchor-shift-y))',
          bottom: placement.above ? 'calc(anchor(top) + var(--anchor-gap) - var(--anchor-bottom-margin) - var(--anchor-shift-y))' : 'auto',
          positionTryFallbacks: placement.above ? '--anchored-popup-below' : '--anchored-popup-above'
        }
      : {})
  }
}
