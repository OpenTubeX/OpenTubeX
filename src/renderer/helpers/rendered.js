/**
 * Whether an element is rendered. Background tabs keep their layout without
 * rendering it, so their elements report real sizes, and measuring them lays
 * out the hidden tab. Engines without checkVisibility() hide background tabs
 * with display: none, which leaves their elements without boxes.
 * @param {Element} element
 * @returns {boolean}
 */
export function isRendered(element) {
  return typeof element.checkVisibility === 'function'
    ? element.checkVisibility()
    : element.getClientRects().length > 0
}
