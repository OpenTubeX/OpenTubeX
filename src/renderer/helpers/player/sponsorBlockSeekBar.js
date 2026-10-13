/**
 * Selects the topmost SponsorBlock marker at a seekbar time.
 * Markers later in the array are painted above earlier markers.
 * @param {{ category: string, actionType?: string, startTime: number, endTime: number }[]} segments
 * @param {number} hoverTime
 * @param {number} secondsPerPixel
 */
export function findSponsorBlockSeekBarSegment(segments, hoverTime, secondsPerPixel) {
  const pointTolerance = Math.max(secondsPerPixel, 0.5)

  return segments.findLast((segment) => {
    if (segment.actionType === 'poi' || segment.category === 'poi_highlight') {
      return Math.abs(hoverTime - segment.startTime) <= pointTolerance
    }

    return hoverTime >= segment.startTime && hoverTime <= segment.endTime
  }) ?? null
}

/**
 * Reuse Shaka's painted positions so markers follow buffering, pending seeks
 * and gesture previews without duplicating its seekbar state.
 * @param {HTMLElement} container
 */
export function updateSponsorBlockSeekBarState(container) {
  // Shaka paints six stops: buffer start twice, playhead twice, buffer end twice.
  // The hidden Shorts bar uses the same boundaries with a leading 0% stop.
  const stops = [...container.style.background.matchAll(/(-?\d+(?:\.\d+)?)%/g)]
  if (stops.length !== 6) return

  container.style.setProperty('--sponsorblock-played', stops[2][1])
  container.style.setProperty('--sponsorblock-buffered-start', stops[0][1])
  container.style.setProperty('--sponsorblock-buffered-end', stops[4][1])
}
