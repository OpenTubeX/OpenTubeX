const TICK_MS = 1000

/**
 * Like setTimeout, but counts only time the page was running. Mobile systems
 * freeze a hidden app and run its overdue timers first when it resumes, which
 * would otherwise expire work that never had a chance to run. A timer never
 * fires early, so each tick counts its interval even when it fired late.
 * @param {() => void} callback
 * @param {number} ms
 * @returns {() => void} Cancels the timeout.
 */
export function setActiveTimeout(callback, ms) {
  let remaining = ms
  let timer
  const tick = () => {
    if (remaining <= 0) {
      callback()
      return
    }
    const interval = Math.min(remaining, TICK_MS)
    remaining -= interval
    timer = setTimeout(tick, interval)
  }
  tick()
  return () => clearTimeout(timer)
}
