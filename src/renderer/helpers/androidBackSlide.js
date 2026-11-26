import { applyAnimationSpeed } from './animationSpeed'
import { getFixedBackgroundContainment } from './fixedBackground'
import { isReducedMotionEnabled } from './reducedMotion'

/** How far toward the swipe edge the view behind starts, as a share of the width. */
const PARALLAX = 0.25
/** How much the view behind is dimmed while the current view still covers it. */
const SCRIM_OPACITY = 0.3
/** The gesture maps onto these keyframes, so they need a length but no real duration. */
const TIMELINE = 1000
const SETTLE_DURATION = 300
const SETTLE_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * Frames for each layer of the slide, from the start of the gesture (0) to a
 * view that has left its area (1).
 * @param {'left' | 'right' | 'none'} edge
 * @param {number} width
 */
export function getAndroidBackSlide(edge, width) {
  // The view follows the finger away from the edge the swipe started at.
  const direction = edge === 'right' ? -1 : 1
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
 * @typedef {{ page: HTMLElement | null, scrim: HTMLElement | null, cover?: HTMLElement | null }} AndroidBackSlideReveal
 * @typedef {object} AndroidBackSlideTarget
 * @property {HTMLElement} element The view Back leaves, which slides away with the finger.
 * @property {HTMLElement | null} [area] Clips the slide, and its width is the distance to slide.
 * @property {Record<string, string>} [styles] Lets the view cover the one behind it while it slides.
 * @property {boolean} [covered] Whether `reveal` shows a cover below the view, which slides
 *   with it and casts its shadow, so that the view's own paint does not change.
 * @property {(shown: boolean) => Promise<AndroidBackSlideReveal | null>} [reveal]
 *   Shows the view Back returns to behind the current one, or hides it again.
 * @property {() => HTMLElement | null | Promise<HTMLElement | null>} [getEntering]
 *   The view Back shows when nothing was revealed. Defaults to `element`.
 * @typedef {{ element: HTMLElement, frame: (drag: number) => Keyframe, animation: Animation }} SlideLayer
 * @typedef {{
 *   target: AndroidBackSlideTarget, drag: number, slide: ReturnType<typeof getAndroidBackSlide>,
 *   layers: SlideLayer[], styles: { element: HTMLElement, name: string, value: string, priority: string }[],
 *   revealed: boolean
 * }} SlideState
 */

/**
 * Preview Back to a previous view like Chromium's back navigation: the view
 * slides away with the finger and uncovers the view Back returns to. When that
 * view is still mounted, it comes in from behind with a slight parallax and
 * Back shows it in place. Otherwise the new view slides in from the same place
 * once Back shows it.
 *
 * @param {object} options
 * @param {() => AndroidBackSlideTarget | null} options.getTarget
 * @param {() => Promise<void>} options.back
 * @param {() => boolean} options.isAvailable
 */
export function createAndroidBackSlidePreview({ getTarget, back, isAvailable }) {
  /** @type {SlideState | null} */
  let state = null

  const cancel = () => {
    const current = state
    if (!current) return
    state = null
    current.layers.forEach(layer => layer.animation.cancel())
    // Later styles can override earlier ones on the same element, so undo them in reverse.
    for (const { element, name, value, priority } of current.styles.toReversed()) {
      if (value) element.style.setProperty(name, value, priority)
      else element.style.removeProperty(name)
    }
    current.target.reveal?.(false)
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
      const { element, area } = target
      const slide = getAndroidBackSlide(edge, area?.clientWidth ?? window.innerWidth)
      /** @type {SlideState['styles']} */
      const styles = []
      /** @param {HTMLElement} styled @param {string} name @param {string} value */
      const setStyle = (styled, name, value) => {
        styles.push({ element: styled, name, value: styled.style.getPropertyValue(name), priority: styled.style.getPropertyPriority(name) })
        styled.style.setProperty(name, value, 'important')
      }
      // The view must follow the finger without a competing CSS transition.
      setStyle(element, 'transition', 'none')
      // Without this hint, Chromium paints the view again on every move.
      // Changing the hint repaints the view, so keep one that it already has.
      if (!getComputedStyle(element).willChange.split(',').some(hint => hint.trim() === 'transform')) {
        // The hint would also move the view's card fields, see
        // getFixedBackgroundContainment. Measure them before it changes styles.
        const fields = getFixedBackgroundContainment(element)
        setStyle(element, 'will-change', 'transform')
        for (const field of fields) setStyle(field.element, field.name, field.value)
      }
      if (!target.covered) setStyle(element, 'box-shadow', slide.shadow)
      for (const [name, value] of Object.entries(target.styles ?? {})) setStyle(element, name, value)
      // A view moved aside must not widen its area.
      if (area) setStyle(area, 'overflow-x', 'clip')

      /** @type {SlideState} */
      const current = { target, drag: 0, slide, layers: [], styles, revealed: false }
      state = current
      addLayer(current, element, slide.current)
      target.reveal?.(true).then(rendered => {
        if (state !== current || !rendered) return
        if (rendered.cover) addLayer(current, rendered.cover, slide.current)
        if (!rendered.page) return
        current.revealed = true
        addLayer(current, rendered.page, slide.previous)
        if (rendered.scrim) addLayer(current, rendered.scrim, slide.scrim)
      })
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
      // The view behind has arrived. Drop its preview frames before Back makes
      // it the current view, so nothing moves when it does.
      current.layers.filter(layer => layer.frame !== current.slide.current).forEach(layer => layer.animation.cancel())
      let wentBack = false
      try {
        if (isAvailable()) {
          await back()
          wentBack = true
        }
      } finally {
        if (state === current) cancel()
      }
      // A view that was not kept arrives from where a kept view would have been.
      if (!wentBack || current.revealed) return
      const entering = await (current.target.getEntering?.() ?? current.target.element)
      if (state !== null || !entering?.isConnected) return
      applyAnimationSpeed(entering.animate([
        { ...current.slide.previous(0), opacity: 0 },
        { ...current.slide.previous(1), opacity: 1 }
      ], { duration: SETTLE_DURATION, easing: SETTLE_EASING }))
    },
    cancel,
  }
}
