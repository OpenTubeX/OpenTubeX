export const DEFAULT_SCROLL_SPEED = 100
export const MIN_SCROLL_SPEED = 25
export const MAX_SCROLL_SPEED = 300
export const SCROLL_SPEED_STEP = 5

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll'])
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
 * Applies the configured speed to ordinary wheel scrolling. Wheel gestures
 * owned by a component, such as player controls and Shorts navigation, call
 * preventDefault before reaching this handler and keep their existing action.
 *
 * @param {() => number} getScrollSpeed
 * @returns {() => void} removes the listener
 */
export function initializeScrollSpeed(getScrollSpeed) {
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

    const target = findWheelScrollTarget(event, wheel.axis, wheel.delta)
    if (target === null) {
      return
    }

    event.preventDefault()
    if (target.element === null) {
      return
    }

    const distance = wheelDeltaInPixels(event, target.element, wheel.axis, wheel.delta) *
      speed / DEFAULT_SCROLL_SPEED
    target.element.scrollBy(wheel.axis === 'x'
      ? { left: distance }
      : { top: distance })
  }

  document.addEventListener('wheel', handleWheel, { passive: false })
  return () => document.removeEventListener('wheel', handleWheel)
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
 * @param {WheelEvent} event
 * @param {'x' | 'y'} axis
 * @param {number} delta
 * @returns {{ element: HTMLElement | null } | null}
 */
function findWheelScrollTarget(event, axis, delta) {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement) ||
      target === document.body ||
      target === document.documentElement) {
      continue
    }

    const style = getComputedStyle(target)
    const overflow = axis === 'x' ? style.overflowX : style.overflowY
    if (!SCROLLABLE_OVERFLOW.has(overflow)) {
      continue
    }

    if (canScroll(target, axis, delta)) {
      return { element: target }
    }

    const overscrollBehavior = axis === 'x'
      ? style.overscrollBehaviorX
      : style.overscrollBehaviorY
    if (CONTAINED_OVERSCROLL.has(overscrollBehavior)) {
      return { element: null }
    }
  }

  const page = document.scrollingElement
  return page instanceof HTMLElement && canScroll(page, axis, delta)
    ? { element: page }
    : null
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
