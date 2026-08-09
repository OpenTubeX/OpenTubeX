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
