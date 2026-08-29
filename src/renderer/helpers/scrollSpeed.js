export const DEFAULT_SCROLL_SPEED = 100
export const MIN_SCROLL_SPEED = 25
export const MAX_SCROLL_SPEED = 300
export const SCROLL_SPEED_STEP = 5

const CONTAINED_OVERSCROLL = new Set(['contain', 'none'])

/**
 * @param {unknown} value percentage of the browser's default wheel distance
 * @returns {number}
 */
export function normalizeScrollSpeed(value) {
  const speed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(speed) && speed > 0
    ? Math.min(Math.max(speed, MIN_SCROLL_SPEED), MAX_SCROLL_SPEED)
    : DEFAULT_SCROLL_SPEED
}

/**
 * Applies the configured speed to one scrolling element. Register this on
 * every OverlayScrollbars scroll offset element so native event bubbling can
 * hand input from a nested boundary to its parent.
 *
 * @param {HTMLElement} element
 * @param {() => number} getScrollSpeed
 * @returns {() => void} removes the listener
 */
export function addScrollSpeedHandler(element, getScrollSpeed) {
  // Repeated smooth relative scrolls use the element's current position,
  // which loses wheel deltas that arrive before the animation advances. Keep
  // the destination separately so every delta extends the same animation.
  const smoothTargets = { x: null, y: null }

  const clearSmoothTargets = () => {
    smoothTargets.x = null
    smoothTargets.y = null
  }

  const handleWheel = (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey) {
      return
    }

    const speed = normalizeScrollSpeed(getScrollSpeed())
    if (speed === DEFAULT_SCROLL_SPEED) {
      return
    }

    const wheel = getPrimaryWheelMovement(event)
    if (wheel.delta === 0) {
      return
    }

    const position = wheel.axis === 'x' ? element.scrollLeft : element.scrollTop
    const maximum = wheel.axis === 'x'
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight
    const target = smoothTargets[wheel.axis] ?? position

    if (!canMoveScrollTarget(target, maximum, wheel.delta)) {
      if (hasContainedOverscroll(element, wheel.axis)) {
        // The default scroll is canceled at a contained boundary. Parent
        // handlers see defaultPrevented and leave the page in place.
        event.preventDefault()
      }
      return
    }

    event.preventDefault()
    const distance = wheelDeltaInPixels(event, element, wheel.axis, wheel.delta) *
      speed / DEFAULT_SCROLL_SPEED
    smoothTargets[wheel.axis] = Math.min(
      Math.max(target + distance, 0),
      maximum
    )
    element.scrollTo({
      behavior: 'smooth',
      left: smoothTargets.x ?? element.scrollLeft,
      top: smoothTargets.y ?? element.scrollTop
    })
  }

  element.addEventListener('wheel', handleWheel, { passive: false })
  element.addEventListener('scrollend', clearSmoothTargets)
  return () => {
    element.removeEventListener('wheel', handleWheel)
    element.removeEventListener('scrollend', clearSmoothTargets)
  }
}

/**
 * Uses the dominant wheel axis, matching how the app's other wheel-controlled
 * interfaces interpret diagonal touchpad gestures.
 *
 * @param {WheelEvent} event
 * @returns {{ axis: 'x' | 'y', delta: number }}
 */
function getPrimaryWheelMovement(event) {
  const deltaX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
  const deltaY = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
  return Math.abs(deltaX) > Math.abs(deltaY)
    ? { axis: 'x', delta: deltaX }
    : { axis: 'y', delta: deltaY }
}

/**
 * @param {HTMLElement} element
 * @param {'x' | 'y'} axis
 * @returns {boolean}
 */
function hasContainedOverscroll(element, axis) {
  const style = getComputedStyle(element)
  const overscrollBehavior = axis === 'x'
    ? style.overscrollBehaviorX
    : style.overscrollBehaviorY
  return CONTAINED_OVERSCROLL.has(overscrollBehavior)
}

/**
 * @param {number} target
 * @param {number} maximum
 * @param {number} delta
 */
function canMoveScrollTarget(target, maximum, delta) {
  return maximum > 0 && (delta < 0 ? target > 0 : target < maximum)
}

/**
 * @param {WheelEvent} event
 * @param {HTMLElement} element
 * @param {'x' | 'y'} axis
 * @param {number} delta
 */
function wheelDeltaInPixels(event, element, axis, delta) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
    return delta * (Number.isFinite(lineHeight) ? lineHeight : 16)
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * (axis === 'x' ? element.clientWidth : element.clientHeight)
  }

  return delta
}
