import assert from 'node:assert/strict'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createPopularityPath, getVideoPopularity, isMostReplayed, normalizeVideoPopularityResponse } from '../../src/renderer/helpers/player/videoPopularity.js'

const rawMarkers = [0.2, 1, 0.4].map((intensity, i) => ({
  startMillis: String(i * 1000), durationMillis: '1000', intensityScoreNormalized: intensity
}))

test('popularity reads current YouTube entities and player overlay heatmaps', () => {
  const entity = new YTNodes.MacroMarkersListEntity({
    key: 'heatmap', externalVideoId: 'test',
    markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: rawMarkers }
  })
  const rawPlayerBar = { markersMap: [{
    key: 'HEATSEEKER', value: { heatmap: { heatmapRenderer: {
      heatMarkers: rawMarkers.map(marker => ({ heatMarkerRenderer: {
        timeRangeStartMillis: Number(marker.startMillis),
        markerDurationMillis: Number(marker.durationMillis),
        heatMarkerIntensityScoreNormalized: marker.intensityScoreNormalized
      } }))
    } } }
  }] }
  normalizeVideoPopularityResponse({ playerOverlays: { playerOverlayRenderer: {
    decoratedPlayerBarRenderer: { decoratedPlayerBarRenderer: { playerBar: { multiMarkersPlayerBarRenderer: rawPlayerBar } } }
  } } })
  const playerBar = new YTNodes.MultiMarkersPlayerBar(rawPlayerBar)
  const expected = rawMarkers.map((marker, i) => ({ startSeconds: i, endSeconds: i + 1, intensity: marker.intensityScoreNormalized }))
  assert.deepEqual(getVideoPopularity({ heat_map: entity.toHeatmap() }), expected)
  assert.deepEqual(getVideoPopularity({ player_overlays: { decorated_player_bar: { player_bar: playerBar } } }), expected)
  assert.deepEqual(getVideoPopularity({}), [])
})

test('invalid optional samples are discarded and intensities are clamped', () => {
  const marker = (start, duration, intensity) => ({
    time_range_start_millis: start, marker_duration_millis: duration, heat_marker_intensity_score_normalized: intensity
  })
  const result = getVideoPopularity({ heat_map: { heat_markers: [
    marker(1000, 1000, 2), marker(0, 1000, -1), marker(NaN, 1000, 1),
    marker(-1000, 1000, 1), marker(0, 0, 1), marker(0, Infinity, 1), marker(0, 1000, NaN)
  ] } })
  assert.deepEqual(result, [
    { startSeconds: 0, endSeconds: 1, intensity: 0 },
    { startSeconds: 1, endSeconds: 2, intensity: 1 }
  ])
})

test('graph follows timestamps, clips to the seek range, and omits unavailable data', () => {
  const markers = [{ startSeconds: 10, endSeconds: 30, intensity: 1 }]
  assert.match(createPopularityPath(markers, { start: 0, end: 100 }), /^M 100 40 L 200 4/)
  assert.match(createPopularityPath(markers, { start: 15, end: 25 }), /^M 0 40 L 500 4.*1000 40 Z$/)
  for (const range of [{ start: 0, end: 0 }, { start: 0, end: Infinity }, { start: 40, end: 50 }]) {
    assert.equal(createPopularityPath(markers, range), '')
  }
  assert.equal(createPopularityPath([], { start: 0, end: 100 }), '')
  assert.equal(createPopularityPath([{ ...markers[0], intensity: 0 }], { start: 0, end: 100 }), '')
})

test('most replayed identifies only peak intervals, including ties', () => {
  const markers = getVideoPopularity({ heat_map: new YTNodes.MacroMarkersListEntity({
    markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: rawMarkers }
  }).toHeatmap() })
  assert.equal(isMostReplayed(markers, 0.5), false)
  assert.equal(isMostReplayed(markers, 1), true)
  assert.equal(isMostReplayed(markers, 2), false)
  assert.equal(isMostReplayed([...markers, { startSeconds: 4, endSeconds: 5, intensity: 1 }], 4.5), true)
  assert.equal(isMostReplayed([], 0), false)
  assert.equal(isMostReplayed([{ startSeconds: 0, endSeconds: 1, intensity: 0 }], 0.5), false)
})
