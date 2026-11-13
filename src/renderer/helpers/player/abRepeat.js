export const AbRepeatValidation = Object.freeze({
  END_NOT_AFTER_START: 'end-not-after-start',
  OUTSIDE_DURATION: 'outside-duration',
})

/**
 * @param {number | null} seconds
 * @returns {string}
 */
export function formatAbRepeatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return ''
  }

  const roundedMilliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(roundedMilliseconds / 3_600_000)
  const minutes = Math.floor(roundedMilliseconds / 60_000) % 60
  const wholeSeconds = Math.floor(roundedMilliseconds / 1000) % 60
  const milliseconds = roundedMilliseconds % 1000
  const secondsLabel = `${String(wholeSeconds).padStart(2, '0')}${
    milliseconds === 0 ? '' : `.${String(milliseconds).padStart(3, '0').replace(/0+$/, '')}`
  }`

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secondsLabel}`
  }

  return `${minutes}:${secondsLabel}`
}

/**
 * @param {number | null} start
 * @param {number | null} end
 * @param {number} duration
 * @returns {string | null}
 */
export function validateAbRepeatRange(start, end, duration = Number.POSITIVE_INFINITY) {
  if (
    (start !== null && (!Number.isFinite(start) || start < 0)) ||
    (end !== null && (!Number.isFinite(end) || end < 0)) ||
    (Number.isFinite(duration) && duration >= 0 && (start > duration || end > duration))
  ) {
    return AbRepeatValidation.OUTSIDE_DURATION
  }

  if (start !== null && end !== null && end <= start) {
    return AbRepeatValidation.END_NOT_AFTER_START
  }

  return null
}

/**
 * @param {number | null} start
 * @param {number | null} end
 * @param {number} duration
 * @returns {boolean}
 */
export function isCompleteAbRepeatRange(start, end, duration = Number.POSITIVE_INFINITY) {
  return start !== null && end !== null && validateAbRepeatRange(start, end, duration) === null
}

/**
 * Calculates when the next boundary check should run at the current playback rate.
 * @param {number} currentTime
 * @param {number} end
 * @param {number} playbackRate
 * @param {number} leadMs
 * @returns {number}
 */
export function getAbRepeatBoundaryDelay(currentTime, end, playbackRate, leadMs = 12) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(end) || playbackRate <= 0) {
    return 0
  }

  return Math.max(0, ((end - currentTime) * 1000 / playbackRate) - leadMs)
}
