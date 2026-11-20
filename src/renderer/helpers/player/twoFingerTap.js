// A finger that travels further than this belongs to a pinch or a drag. Video
// zoom waits for the same distance before a pinch starts zooming.
export const TWO_FINGER_TAP_SLOP = 12
// From the first finger down to the last finger up.
export const TWO_FINGER_TAP_MAX_DURATION = 450
// From the last finger up of one tap to the first finger down of the next.
export const TWO_FINGER_DOUBLE_TAP_GAP = 350

/**
 * @typedef {{ startX: number, startY: number, maxDistance: number }} TwoFingerTapTouch
 */

/**
 * @param {TwoFingerTapTouch[]} touches every finger of the gesture
 * @param {number} duration from the first finger down to the last finger up
 * @returns {{ x: number, y: number } | null} the centroid where the fingers
 * landed, or null when the gesture was not a two-finger tap
 */
export function getTwoFingerTapPoint(touches, duration) {
  if (touches.length !== 2 || !(duration >= 0 && duration <= TWO_FINGER_TAP_MAX_DURATION)) return null
  if (touches.some(touch => touch.maxDistance > TWO_FINGER_TAP_SLOP)) return null
  return {
    x: (touches[0].startX + touches[1].startX) / 2,
    y: (touches[0].startY + touches[1].startY) / 2,
  }
}

/**
 * @param {{ direction: number, endTime: number } | null} previous the last tap
 * @param {{ direction: number, startTime: number }} tap
 */
export function isTwoFingerDoubleTap(previous, tap) {
  return previous !== null && tap.direction !== 0 && previous.direction === tap.direction &&
    tap.startTime - previous.endTime <= TWO_FINGER_DOUBLE_TAP_GAP
}
