import { nextTick } from 'vue'
import { applyAnimationSpeed } from './animationSpeed'
import { isReducedMotionEnabled } from './reducedMotion'

// Shared by the watch and external media pages, which use the same layout
// (scss-partials/_watch-layout.scss).

export const THEATRE_MODE_ANIMATION_DURATION = 400
// Matches the player's theater button breakpoint.
export const RESPONSIVE_THEATRE_MODE_MAX_WIDTH = 1350

const ANIMATED_AREAS = ['.videoPlayer', '.infoArea', '.sidebarArea', '.commentsArea']
const ANIMATION_OPTIONS = {
  duration: THEATRE_MODE_ANIMATION_DURATION,
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
}

export function isTheatreLayoutAvailable() {
  return window.innerWidth > RESPONSIVE_THEATRE_MODE_MAX_WIDTH
}

/**
 * Animates the layout areas from their previous positions and widths after a
 * theater mode change or after the sidebar appears or disappears. Starting a
 * new change cancels the previous animation.
 */
export function createWatchLayoutAnimator() {
  /** @type {Animation[]} */
  let animations = []
  /** @type {Set<HTMLElement>} */
  const insetElements = new Set()
  /** @type {HTMLElement | null} */
  let clippedLayout = null

  function cleanUp() {
    document.removeEventListener('scroll', placeFixedBackgrounds, { capture: true })
    insetElements.forEach(element => element.style.removeProperty('--fixed-background-inset'))
    insetElements.clear()
    clippedLayout?.style.removeProperty('overflow-x')
    clippedLayout = null
  }

  function cancel() {
    animations.forEach(animation => animation.cancel())
    animations = []
    cleanUp()
  }

  /** @param {Animation} animation */
  function track(animation) {
    const end = () => {
      // A cancelled run may still deliver queued events.
      if (!animations.includes(animation)) { return }
      animations = animations.filter(item => item !== animation)
      if (animations.length === 0) {
        cleanUp()
      }
    }
    animation.addEventListener('finish', end)
    animation.addEventListener('cancel', end)
    animations.push(animation)
  }

  /**
   * Covers the viewport with the fixed layers of each animated area, measured
   * from the area's box without its animated translation. Scrolling moves
   * that box, so this runs again on scroll.
   */
  function placeFixedBackgrounds() {
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = document.documentElement
    insetElements.forEach(element => {
      const rect = element.getBoundingClientRect()
      const { m41: translateX, m42: translateY } = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      const left = rect.left - translateX + element.clientLeft
      const top = rect.top - translateY + element.clientTop
      element.style.setProperty('--fixed-background-inset', [
        -top,
        left + element.clientWidth - viewportWidth,
        top + element.clientHeight - viewportHeight,
        -left
      ].map(value => `${value}px`).join(' '))
    })
  }

  /**
   * Themes with fixed card backgrounds (FtFixedBackground) paint them in a
   * fixed layer. A transformed area becomes that layer's containing block
   * instead of the viewport, which would move the field with the area and
   * snap it back when the animation ends. Place the layers over the viewport
   * and move them against the area instead.
   * @param {HTMLElement} element
   * @param {number} offsetX
   * @param {number} offsetY
   */
  function keepFixedBackgroundsInPlace(element, offsetX, offsetY) {
    const layers = element.querySelectorAll('.fixedBackgroundLayer')
    if (layers.length === 0) { return }

    insetElements.add(element)
    layers.forEach(layer => {
      track(applyAnimationSpeed(layer.animate([
        { transform: `translate(${-offsetX}px, ${-offsetY}px)` },
        { transform: 'none' }
      ], { ...ANIMATION_OPTIONS, pseudoElement: '::before' })))
    })
  }

  /**
   * @param {HTMLElement | null | undefined} layout
   * @param {() => void} [applyChange] Changes the layout. Watchers that run
   * before the render that changes it can omit it.
   */
  async function animate(layout, applyChange) {
    const elements = ANIMATED_AREAS.flatMap(selector => layout?.querySelector(selector) ?? [])
    const reducedMotion = isReducedMotionEnabled()
    // Measure before cancelling, so an interrupted animation continues from
    // where the areas are drawn instead of jumping to their final positions.
    const previousRects = reducedMotion ? [] : elements.map(element => element.getBoundingClientRect())
    const previousCardMargins = reducedMotion ? [] : measureCardMargins(layout)
    const hadSidebar = !layout?.classList.contains('noSidebar')
    cancel()
    applyChange?.()
    if (reducedMotion) { return }

    await nextTick()
    if (!layout?.isConnected) { return }

    // The areas start where they were drawn, and the scaled player can reach
    // past the page, which would flash a horizontal scrollbar.
    if (elements.length > 0) {
      clippedLayout = layout
      layout.style.overflowX = 'clip'
    }

    const hasSidebar = !layout.classList.contains('noSidebar')
    const rtl = getComputedStyle(layout).direction === 'rtl'
    let infoEndOffset = 0

    elements.forEach((element, index) => {
      const previousRect = previousRects[index]
      const nextRect = element.getBoundingClientRect()
      const isVideoPlayer = element.classList.contains('videoPlayer')
      if (element.classList.contains('sidebarArea')) {
        if (!hadSidebar && hasSidebar && Math.abs(infoEndOffset) >= 0.5) {
          // An appearing sidebar has no previous place. It slides in beside
          // the narrowing info area instead. Its relative offset is laid out
          // in the same frame as the info area's margin, which a transform on
          // the compositor would run ahead of.
          track(applyAnimationSpeed(element.animate([
            { left: `${infoEndOffset}px` },
            { left: '0px' }
          ], ANIMATION_OPTIONS)))
        }
        // A disappearing sidebar is already empty.
        if (!hadSidebar || !hasSidebar) { return }
      }

      // Only the player scales. The other areas change their width instead,
      // so their content reflows and slides with their end edge.
      const resizes = !isVideoPlayer && Math.abs(previousRect.width - nextRect.width) >= 1
      if (resizes) {
        resize(element, previousRect.width, nextRect.width)
        if (element.classList.contains('infoArea')) {
          infoEndOffset = rtl ? previousRect.left - nextRect.left : previousRect.right - nextRect.right
        }
      }
      // A resizing area stays at its inline start.
      const offsetX = resizes
        ? (rtl ? previousRect.right - nextRect.right : previousRect.left - nextRect.left)
        : previousRect.left - nextRect.left
      const offsetY = previousRect.top - nextRect.top
      if (isVideoPlayer) {
        const scaleX = previousRect.width / nextRect.width
        const scaleY = previousRect.height / nextRect.height
        if (offsetX === 0 && offsetY === 0 && scaleX === 1 && scaleY === 1) { return }
        track(applyAnimationSpeed(element.animate([
          {
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`,
            transformOrigin: 'top left'
          },
          { transform: 'none', transformOrigin: 'top left' }
        ], ANIMATION_OPTIONS)))
      } else {
        translate(element, offsetX, offsetY)
      }
    })

    // The cards' side gaps depend on the layout too.
    previousCardMargins.forEach(([card, previousMargins]) => {
      const nextMargins = cardMargins(card)
      if (!card.isConnected || nextMargins.every((margin, index) => margin === previousMargins[index])) { return }
      track(applyAnimationSpeed(card.animate([
        { marginInlineStart: previousMargins[0], marginInlineEnd: previousMargins[1] },
        { marginInlineStart: nextMargins[0], marginInlineEnd: nextMargins[1] }
      ], ANIMATION_OPTIONS)))
    })

    if (insetElements.size > 0) {
      placeFixedBackgrounds()
      document.addEventListener('scroll', placeFixedBackgrounds, { capture: true, passive: true })
    }
  }

  /**
   * @param {HTMLElement | null | undefined} layout
   * @returns {[HTMLElement, string[]][]}
   */
  function measureCardMargins(layout) {
    /** @type {HTMLElement[]} */
    const cards = Array.from(layout?.querySelectorAll('.infoArea .watchVideo, .commentsArea .watchVideo') ?? [])
    return cards.map(card => [card, cardMargins(card)])
  }

  /** @param {HTMLElement} card */
  function cardMargins(card) {
    const style = getComputedStyle(card)
    return [style.marginInlineStart, style.marginInlineEnd]
  }

  /**
   * @param {HTMLElement} element
   * @param {number} offsetX
   * @param {number} offsetY
   */
  function translate(element, offsetX, offsetY) {
    // A transform would also make the area the containing block of its fixed
    // backgrounds, so leave areas that don't move alone.
    if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) { return }
    track(applyAnimationSpeed(element.animate([
      { transform: `translate(${offsetX}px, ${offsetY}px)` },
      { transform: 'none' }
    ], ANIMATION_OPTIONS)))
    keepFixedBackgroundsInPlace(element, offsetX, offsetY)
  }

  /**
   * @param {HTMLElement} element
   * @param {number} previousWidth
   * @param {number} nextWidth
   */
  function resize(element, previousWidth, nextWidth) {
    // The area keeps stretching across its grid area while its end margin
    // makes up the difference. Unlike a width, a margin doesn't widen the grid
    // tracks, which would squeeze the sidebar during the animation.
    const marginEnd = parseFloat(getComputedStyle(element).marginInlineEnd)
    track(applyAnimationSpeed(element.animate([
      { marginInlineEnd: `${marginEnd + nextWidth - previousWidth}px` },
      { marginInlineEnd: `${marginEnd}px` }
    ], ANIMATION_OPTIONS)))
  }

  return { animate, cancel }
}
