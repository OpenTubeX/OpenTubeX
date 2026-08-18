/**
 * Finds the latest-starting cue that is active at the current playback time.
 * `activeUntil` is the greatest end time through each position, which lets the
 * backwards overlap check stop immediately for the usual non-overlapping case.
 * @param {{ index: number, start: number, end: number, activeUntil?: number }[]} segments
 * @param {number} currentTime
 * @returns {number}
 */
export function findActiveTranscriptSegmentIndex(segments, currentTime) {
  let low = 0
  let high = segments.length - 1
  let candidate = -1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (segments[middle].start <= currentTime) {
      candidate = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  for (let index = candidate; index >= 0; index--) {
    const segment = segments[index]
    if (currentTime < segment.end) {
      return segment.index
    }
    if ((segment.activeUntil ?? Number.POSITIVE_INFINITY) <= currentTime) {
      break
    }
  }

  return -1
}
