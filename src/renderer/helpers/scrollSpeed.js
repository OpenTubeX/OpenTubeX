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

    if (!canScroll(element, wheel.axis, wheel.delta)) {
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
    element.scrollBy(wheel.axis === 'x'
      ? { left: distance }
      : { top: distance })
  }

  element.addEventListener('wheel', handleWheel, { passive: false })
  return () => element.removeEventListener('wheel', handleWheel)
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
 * @param {HTMLElement} element
 * @param {'x' | 'y'} axis
 * @param {number} delta
 */
function canScroll(element, axis, delta) {
  const position = axis === 'x' ? element.scrollLeft : element.scrollTop
  const maximum = axis === 'x'
    ? element.scrollWidth - element.clientWidth
    : element.scrollHeight - element.clientHeight
  return maximum > 0 && (delta < 0 ? position > 0 : position < maximum)
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
