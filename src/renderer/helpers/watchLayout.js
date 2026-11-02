import { nextTick } from 'vue'
import { applyAnimationSpeed } from './animationSpeed'
import { isReducedMotionEnabled } from './reducedMotion'

// Shared by the watch and external media pages, which use the same layout
// (scss-partials/_watch-layout.scss).

export const THEATRE_MODE_ANIMATION_DURATION = 400
// Matches the player's theatre button breakpoint.
export const RESPONSIVE_THEATRE_MODE_MAX_WIDTH = 1350

const ANIMATED_AREAS = ['.videoPlayer', '.infoArea', '.sidebarArea', '.commentsArea']

export function isTheatreLayoutAvailable() {
  return window.innerWidth > RESPONSIVE_THEATRE_MODE_MAX_WIDTH
}

/**
 * Animates the layout areas from their previous positions after a theatre
 * mode change. Starting a new change cancels the previous animation.
 */
export function createTheatreModeAnimator() {
  /** @type {Animation[]} */
  let animations = []

  function cancel() {
    animations.forEach(animation => animation.cancel())
    animations = []
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

    animations = elements.map((element, index) => {
      const previousRect = previousRects[index]
      const nextRect = element.getBoundingClientRect()
      const isVideoPlayer = element.classList.contains('videoPlayer')
      const scaleX = isVideoPlayer ? previousRect.width / nextRect.width : 1
      const scaleY = isVideoPlayer ? previousRect.height / nextRect.height : 1
      const animation = applyAnimationSpeed(element.animate([
        {
          transform: `translate(${previousRect.left - nextRect.left}px, ${previousRect.top - nextRect.top}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left'
        },
        { transform: 'none', transformOrigin: 'top left' }
      ], {
        duration: THEATRE_MODE_ANIMATION_DURATION,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
      }))
      animation.addEventListener('finish', () => {
        animations = animations.filter(item => item !== animation)
      })
      return animation
    })
  }

  return { animate, cancel }
}
