import { applyAnimationSpeed } from './animationSpeed'
import { isReducedMotionEnabled } from './reducedMotion'

/** How far toward the swipe edge the page behind starts, as a share of the width. */
const PARALLAX = 0.25
/** How much the page behind is dimmed while the current page still covers it. */
const SCRIM_OPACITY = 0.3
/** The gesture maps onto these keyframes, so they need a length but no real duration. */
const TIMELINE = 1000
const SETTLE_DURATION = 300
const SETTLE_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * Frames for each layer of the slide, from the start of the gesture (0) to a
 * page that has left the screen (1).
 * @param {'left' | 'right' | 'none'} edge
 */
export function getAndroidBackPageSlide(edge) {
  // The page follows the finger away from the edge the swipe started at.
  const direction = edge === 'right' ? -1 : 1
  const width = window.innerWidth
  return {
    /** @param {number} drag */
    current: drag => ({ transform: `translateX(${direction * width * drag}px)` }),
    /** @param {number} drag */
    previous: drag => ({ transform: `translateX(${-direction * width * PARALLAX * (1 - drag)}px)` }),
    /** @param {number} drag */
    scrim: drag => ({ opacity: SCRIM_OPACITY * (1 - drag) }),
    shadow: `${-direction * 2}px 0 16px rgb(0 0 0 / 30%)`
  }
}

/**
 * @typedef {{ element: HTMLElement, frame: (drag: number) => Keyframe, animation: Animation }} SlideLayer
 * @typedef {{
 *   element: HTMLElement, revealed: boolean, drag: number, slide: ReturnType<typeof getAndroidBackPageSlide>,
 *   layers: SlideLayer[], styles: { element: HTMLElement, name: string, value: string, priority: string }[]
 * }} SlideState
 */

/**
 * Preview Back to the tab's previous page like Chromium's back navigation:
 * the page slides away with the finger and uncovers the page Back returns to.
 * When the tab kept that page mounted, it comes in from behind with a slight
 * parallax and Back shows it in place. Otherwise the new page slides in from
 * the same place once it loads.
 *
 * @param {object} options
 * @param {() => { element: HTMLElement, reveal: { key: number, top: number } | null } | null} options.getTarget
 * @param {(reveal: { key: number, top: number } | null) => Promise<{ page: HTMLElement | null, scrim: HTMLElement | null } | null>} options.setReveal
 *   Shows the retained page behind the current one and resolves with its rendered elements.
 * @param {() => Promise<void>} options.back
 * @param {() => boolean} options.isAvailable
 */
export function createAndroidBackPagePreview({ getTarget, setReveal, back, isAvailable }) {
  /** @type {SlideState | null} */
  let state = null

  const cancel = () => {
    const current = state
    if (!current) return
    state = null
    current.layers.forEach(layer => layer.animation.cancel())
    for (const { element, name, value, priority } of current.styles) {
      if (value) element.style.setProperty(name, value, priority)
      else element.style.removeProperty(name)
    }
    if (current.revealed) setReveal(null)
  }

  /**
   * @param {SlideState} current
   * @param {HTMLElement} element
   * @param {(drag: number) => Keyframe} frame
   */
  const addLayer = (current, element, frame) => {
    const animation = element.animate([frame(0), frame(1)], { duration: TIMELINE, fill: 'both' })
    animation.pause()
    animation.currentTime = current.drag * TIMELINE
    current.layers.push({ element, frame, animation })
  }

  /**
   * Finish the slide from where the finger left it. Each layer gets a new
   * animation from its current frame, which the compositor can run.
   * @param {SlideState} current
   * @param {number} target
   */
  const settle = async (current, target) => {
    const duration = Math.max(120, SETTLE_DURATION * Math.abs(target - current.drag))
    current.layers = current.layers.map(layer => {
      const animation = applyAnimationSpeed(layer.element.animate([layer.frame(current.drag), layer.frame(target)], {
        duration,
        easing: SETTLE_EASING,
        fill: 'forwards'
      }))
      layer.animation.cancel()
      return { ...layer, animation }
    })
    current.drag = target
    await Promise.all(current.layers.map(layer => layer.animation.finished.catch(() => {})))
  }

  return {
    /** @param {{ edge?: 'left' | 'right' | 'none' }} [event] */
    begin({ edge = 'none' } = {}) {
      if (!isAvailable() || isReducedMotionEnabled()) return false
      const target = getTarget()
      if (!target?.element.isConnected) return false
      const { element, reveal } = target
      const slide = getAndroidBackPageSlide(edge)
      /** @type {SlideState['styles']} */
      const styles = []
      /** @param {HTMLElement} styled @param {string} name @param {string} value */
      const setStyle = (styled, name, value) => {
        styles.push({ element: styled, name, value: styled.style.getPropertyValue(name), priority: styled.style.getPropertyPriority(name) })
        styled.style.setProperty(name, value, 'important')
      }
      // The page must follow the finger without a competing CSS transition.
      setStyle(element, 'transition', 'none')
      // Without this hint, Chromium paints the page again on every move.
      setStyle(element, 'will-change', 'transform')
      // Cover the page behind, also below the end of a short page.
      setStyle(element, 'background-color', 'var(--bg-color)')
      setStyle(element, 'min-block-size', `${Math.max(0, window.innerHeight - element.getBoundingClientRect().top)}px`)
      setStyle(element, 'box-shadow', slide.shadow)
      // A page moved aside must not widen the document.
      const pageArea = element.closest('.app > .routerView')
      if (pageArea instanceof HTMLElement) setStyle(pageArea, 'overflow-x', 'clip')

      /** @type {SlideState} */
      const current = { element, revealed: reveal !== null, drag: 0, slide, layers: [], styles }
      state = current
      addLayer(current, element, slide.current)
      if (reveal) {
        setReveal(reveal).then(rendered => {
          if (state !== current || !rendered?.page) return
          addLayer(current, rendered.page, slide.previous)
          if (rendered.scrim) addLayer(current, rendered.scrim, slide.scrim)
        })
      }
      return true
    },
    /** @param {number} _progress @param {number} drag */
    update(_progress, drag) {
      if (!state) return
      state.drag = drag
      state.layers.forEach(layer => { layer.animation.currentTime = drag * TIMELINE })
    },
    /** @param {boolean} commit */
    async finish(commit) {
      const current = state
      if (!current) return
      await settle(current, commit ? 1 : 0)
      if (state !== current) return
      if (!commit) {
        cancel()
        return
      }
      // The page behind has arrived. Drop its preview frames before Back makes
      // it the current page, so nothing moves when it does.
      current.layers.slice(1).forEach(layer => layer.animation.cancel())
      let wentBack = false
      try {
        if (isAvailable()) {
          await back()
          wentBack = true
        }
      } finally {
        if (state === current) {
          cancel()
          // A newly loaded page arrives from where a kept page would have been.
          if (wentBack && !current.revealed && current.element.isConnected) {
            applyAnimationSpeed(current.element.animate([
              { ...current.slide.previous(0), opacity: 0 },
              { ...current.slide.previous(1), opacity: 1 }
            ], { duration: SETTLE_DURATION, easing: SETTLE_EASING }))
          }
        }
      }
    },
    cancel,
  }
}
