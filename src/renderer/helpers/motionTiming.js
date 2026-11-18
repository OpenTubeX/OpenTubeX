import { isReducedMotionEnabled } from './reducedMotion'

/**
 * Reads a spring motion token from themes.css as Web Animations timing. WebViews
 * without linear() easing support keep the given fallback.
 * @param {string} token
 * @param {number} fallbackDuration
 * @param {string} fallbackEasing
 * @returns {{ duration: number, easing: string }}
 */
export function motionTiming(token, fallbackDuration, fallbackEasing) {
  if (isReducedMotionEnabled()) return { duration: 0, easing: 'linear' }
  const [, duration, easing] = getComputedStyle(document.body).getPropertyValue(token).trim().match(/^([\d.]+)ms\s+(.+)$/) ?? []
  if (duration === undefined || !CSS.supports('transition-timing-function', easing)) {
    return { duration: fallbackDuration, easing: fallbackEasing }
  }
  return { duration: Number(duration), easing }
}
