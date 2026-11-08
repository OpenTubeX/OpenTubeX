/**
 * @typedef {{startSeconds: number, endSeconds: number, intensity: number}} PopularityMarker
 */

/**
 * youtubei.js expects entity field names even inside older player overlays.
 * Normalize the overlay before parsing so its optional samples survive.
 * @param {object} response the raw YouTube watch-next response
 */
export function normalizeVideoPopularityResponse(response) {
  const heatmap = response.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer
    ?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap
    ?.find(marker => marker.key === 'HEATSEEKER')?.value?.heatmap?.heatmapRenderer
  for (const { heatMarkerRenderer: marker } of heatmap?.heatMarkers ?? []) {
    if (!marker) continue
    marker.startMillis ??= marker.timeRangeStartMillis
    marker.durationMillis ??= marker.markerDurationMillis
    marker.intensityScoreNormalized ??= marker.heatMarkerIntensityScoreNormalized
  }
}

/**
 * Both current entity-based responses and player-overlay responses are parsed
 * by youtubei.js. Keep optional popularity metadata independent of playback.
 * @param {import('youtubei.js').YT.VideoInfo} info
 * @returns {PopularityMarker[]}
 */
export function getVideoPopularity(info) {
  const heatmap = info.heat_map ?? info.player_overlays?.decorated_player_bar?.player_bar?.markers_map
    ?.find(marker => marker.marker_key === 'HEATSEEKER')?.value.heatmap
  return (heatmap?.heat_markers ?? []).flatMap(marker => {
    const startSeconds = marker.time_range_start_millis / 1000
    const endSeconds = startSeconds + marker.marker_duration_millis / 1000
    const intensity = marker.heat_marker_intensity_score_normalized
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) ||
        endSeconds <= startSeconds || !Number.isFinite(intensity)) return []
    return [{ startSeconds, endSeconds, intensity: Math.min(1, Math.max(0, intensity)) }]
  }).sort((a, b) => a.startSeconds - b.startSeconds)
}

/**
 * Draw a smooth area in a fixed SVG coordinate system. Quadratic curves stay
 * within the samples' heights instead of overshooting sharp replay peaks.
 * @param {PopularityMarker[]} markers
 * @param {{start: number, end: number}} range
 * @returns {string}
 */
export function createPopularityPath(markers, { start, end }) {
  const duration = end - start
  if (!Number.isFinite(duration) || duration <= 0) return ''
  const visible = markers.filter(marker => marker.endSeconds > start && marker.startSeconds < end)
  if (!visible.some(marker => marker.intensity > 0)) return ''
  const x = time => Math.min(1000, Math.max(0, (time - start) / duration * 1000))
  const points = visible.map(marker => ({
    x: x((Math.max(start, marker.startSeconds) + Math.min(end, marker.endSeconds)) / 2),
    y: 40 - marker.intensity * 36
  }))
  let path = `M ${x(visible[0].startSeconds)} 40 L ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const point = points[i]
    const next = points[i + 1]
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  }
  const last = points.at(-1)
  return `${path} Q ${last.x} ${last.y} ${x(visible.at(-1).endSeconds)} ${last.y} L ${x(visible.at(-1).endSeconds)} 40 Z`
}

/**
 * @param {PopularityMarker[]} markers
 * @param {number} time
 * @returns {boolean}
 */
export function isMostReplayed(markers, time) {
  const maximum = Math.max(0, ...markers.map(marker => marker.intensity))
  return maximum > 0 && markers.some(marker =>
    marker.intensity === maximum && time >= marker.startSeconds && time < marker.endSeconds)
}
