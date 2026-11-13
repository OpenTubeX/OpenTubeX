// @ts-check

/** @typedef {{ stiffness: number, damping: number }} SpringSpec */

/** Docking glides into the bar: critically damped and slow, at rest about 700ms after starting still. */
export const COLLAPSE_SPRING = { stiffness: 130, damping: 1 }
/** Returning to Watch is quicker: Material's standard slow spatial spring, arriving after about 360ms. */
export const EXPAND_SPRING = { stiffness: 300, damping: 0.9 }

// Within 0.3% of the target, about 2px across the dock path, the spring is at rest.
const REST_DELTA = 0.003

/**
 * A damped spring between two values, so a release keeps the finger's speed and
 * eases into place instead of restarting from a fixed curve. The spring stops
 * at its target, so a fling carries into the endpoint instead of overshooting it.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} velocity units per millisecond
 * @param {SpringSpec} spec stiffness per unit mass in s⁻², and damping ratio up to 1
 * @returns {{ at: (elapsed: number) => number, done: (elapsed: number) => boolean }}
 */
export function createSpring(from, to, velocity, { stiffness, damping }) {
  const omega = Math.sqrt(stiffness) / 1000
  const x0 = from - to
  const decay = damping * omega
  /** @type {(elapsed: number) => number} */
  let displacement
  /** @type {(elapsed: number) => number} */
  let envelope
  // When the spring first reaches its target, or Infinity if it only approaches it.
  let arrival = Infinity
  if (damping >= 1) {
    const b = velocity + omega * x0
    displacement = elapsed => Math.exp(-omega * elapsed) * (x0 + b * elapsed)
    envelope = elapsed => Math.abs(displacement(elapsed))
    if (b !== 0 && -x0 / b > 0) arrival = -x0 / b
  } else {
    const damped = omega * Math.sqrt(1 - damping * damping)
    const b = (velocity + decay * x0) / damped
    const amplitude = Math.hypot(x0, b)
    displacement = elapsed => Math.exp(-decay * elapsed) * (x0 * Math.cos(damped * elapsed) + b * Math.sin(damped * elapsed))
    envelope = elapsed => Math.exp(-decay * elapsed) * amplitude
    let phase = Math.atan2(-x0, b)
    if (phase <= 0) phase += Math.PI
    if (x0 !== 0) arrival = phase / damped
  }
  return {
    at: elapsed => elapsed <= 0 ? from : elapsed >= arrival ? to : to + displacement(elapsed),
    done: elapsed => elapsed >= arrival || envelope(Math.max(0, elapsed)) < REST_DELTA,
  }
}

/**
 * Tracks a pointer-driven value and reports its recent velocity.
 * @param {number} [initialValue] where the value starts, sampled at initialTime
 * @param {number} [initialTime]
 */
export function createVelocityTracker(initialValue = undefined, initialTime = performance.now()) {
  /** @type {{ time: number, value: number }[]} */
  let samples = initialValue === undefined ? [] : [{ time: initialTime, value: initialValue }]
  return {
    /** @param {number} value */
    add(value, time = performance.now()) {
      samples.push({ time, value })
      samples = samples.filter(sample => time - sample.time <= 100)
    },
    /** Units per millisecond. A finger that rested before release has no velocity. */
    velocity(time = performance.now()) {
      const first = samples[0]
      const last = samples.at(-1)
      // Samples less than a frame apart cannot tell the speed of the finger.
      if (!first || !last || last.time - first.time < 8 || time - last.time > 60) return 0
      return (last.value - first.value) / (last.time - first.time)
    },
  }
}
