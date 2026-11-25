// @ts-check

// Room between a revealed control and the bar above it, enough for its focus ring.
const FOCUS_CLEARANCE_GAP = 8
// The header, a top tab bar, a page toolbar and a pinned player can stack.
const MAX_STACKED_BARS = 4

/**
 * Returns the nearest element from `element` up that is `position: sticky` or
 * `fixed`, which stays in place while the page scrolls under it.
 * @param {Element} element
 * @returns {{ element: Element, position: string } | null}
 */
function findPinnedAncestor(element) {
  const root = element.ownerDocument.body
  for (let current = /** @type {Element | null} */ (element); current && current !== root; current = current.parentElement) {
    const { position } = getComputedStyle(current)
    if (position === 'sticky' || position === 'fixed') return { element: current, position }
  }
  return null
}

/**
 * Scrolls the page so a focused element no longer sits under the sticky bars
 * at its top: the header, the top tab bar, page toolbars and the pinned Watch
 * page player. Root scroll-padding can't do this, because Chromium then also
 * scrolls the page to move elements inside those bars out of the padding.
 * Elements inside a sticky or fixed element are left alone, since scrolling
 * the page doesn't move them.
 * @param {Element} target
 */
export function revealFocusedElement(target) {
  const pageDocument = target.ownerDocument
  const view = pageDocument.defaultView
  if (!view || pageDocument.activeElement !== target || !target.matches(':focus-visible') ||
      findPinnedAncestor(target) !== null) {
    return
  }

  const rect = target.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), view.innerWidth - 1)
  let clearTop = Math.max(rect.top, 0)
  // Bars that stack below the ones covering the target would cover it once
  // the page scrolls it below them, so the search continues past its bottom.
  for (let i = 0; i < MAX_STACKED_BARS && clearTop < view.innerHeight; i++) {
    const hit = pageDocument.elementFromPoint(x, clearTop + 0.5)
    if (!hit || target.contains(hit) || hit.contains(target)) break
    const bar = findPinnedAncestor(hit)
    // Fixed elements are overlays and the bottom bars, which scroll-padding keeps clear.
    if (bar?.position !== 'sticky') break
    const barBottom = bar.element.getBoundingClientRect().bottom
    // A bar as tall as the window, such as the side navigation, isn't above the target.
    if (barBottom <= clearTop || barBottom >= view.innerHeight) break
    clearTop = barBottom
  }

  const covered = clearTop - rect.top
  if (covered > 0) {
    view.scrollBy({ top: -(covered + FOCUS_CLEARANCE_GAP), behavior: 'instant' })
  }
}

/**
 * Keeps keyboard focus in the page clear of the sticky bars at its top. Focus
 * scrolls its target into view after the focus events, so the check waits for
 * the next frame, which still comes before that scroll is painted.
 * @param {Document} pageDocument
 * @returns {() => void} removes the listener
 */
export function installFocusClearance(pageDocument) {
  const view = pageDocument.defaultView
  if (!view) return () => {}
  let frame = 0
  /** @param {FocusEvent} event */
  const handleFocusIn = (event) => {
    const target = event.target
    if (!(target instanceof view.Element)) return
    view.cancelAnimationFrame(frame)
    frame = view.requestAnimationFrame(() => revealFocusedElement(target))
  }
  pageDocument.addEventListener('focusin', handleFocusIn)
  return () => {
    view.cancelAnimationFrame(frame)
    pageDocument.removeEventListener('focusin', handleFocusIn)
  }
}
