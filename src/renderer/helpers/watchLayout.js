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
 * Animates the layout areas from their previous positions after a theater
 * mode change. Starting a new change cancels the previous animation.
 */
export function createTheatreModeAnimator() {
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
   * @param {() => void} applyChange
   */
  async function animate(layout, applyChange) {
    const elements = ANIMATED_AREAS.flatMap(selector => layout?.querySelector(selector) ?? [])
    const reducedMotion = isReducedMotionEnabled()
    // Measure before cancelling, so an interrupted animation continues from
    // where the areas are drawn instead of jumping to their final positions.
    const previousRects = reducedMotion ? [] : elements.map(element => element.getBoundingClientRect())
    cancel()
    if (reducedMotion) {
      applyChange()
      return
    }

    applyChange()
    await nextTick()

    // The areas start where they were drawn, and the scaled player can reach
    // past the page, which would flash a horizontal scrollbar.
    if (layout && elements.length > 0) {
      clippedLayout = layout
      layout.style.overflowX = 'clip'
    }

    elements.forEach((element, index) => {
      const previousRect = previousRects[index]
      const nextRect = element.getBoundingClientRect()
      const offsetX = previousRect.left - nextRect.left
      const offsetY = previousRect.top - nextRect.top
      // Only the player scales, and it has no fixed backgrounds.
      const isVideoPlayer = element.classList.contains('videoPlayer')
      const scaleX = isVideoPlayer ? previousRect.width / nextRect.width : 1
      const scaleY = isVideoPlayer ? previousRect.height / nextRect.height : 1
      const animation = applyAnimationSpeed(element.animate([
        {
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left'
        },
        { transform: 'none', transformOrigin: 'top left' }
      ], ANIMATION_OPTIONS))
      track(animation)
      if (!isVideoPlayer) {
        keepFixedBackgroundsInPlace(element, offsetX, offsetY)
      }
    })

    if (insetElements.size > 0) {
      placeFixedBackgrounds()
      document.addEventListener('scroll', placeFixedBackgrounds, { capture: true, passive: true })
    }
  }

  return { animate, cancel }
}
