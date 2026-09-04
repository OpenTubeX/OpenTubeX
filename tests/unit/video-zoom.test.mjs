import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_VIDEO_ZOOM,
  formatVideoZoom,
  resolveVideoZoomPinch,
  sanitizeVideoZoom,
  stepVideoZoom,
  VIDEO_ZOOM_LEVELS,
} from '../../src/renderer/helpers/player/videoZoom.js'

test('the offered levels start at no zoom', () => {
  assert.equal(VIDEO_ZOOM_LEVELS[0], DEFAULT_VIDEO_ZOOM)
  assert.equal(DEFAULT_VIDEO_ZOOM, 1)
})

test('unusable values fall back to no zoom', () => {
  assert.equal(sanitizeVideoZoom(undefined), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom(null), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom('nonsense'), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom(NaN), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom(Infinity), DEFAULT_VIDEO_ZOOM)
})

test('continuous values are preserved within the offered range', () => {
  assert.equal(sanitizeVideoZoom(1.4), 1.4)
  assert.equal(sanitizeVideoZoom(2.2), 2.2)
  // out of range values are clamped to the closest end
  assert.equal(sanitizeVideoZoom(0.2), 1)
  assert.equal(sanitizeVideoZoom(10), 3)
})

test('stepping moves one level at a time and stops at both ends', () => {
  assert.equal(stepVideoZoom(1, 1), 1.25)
  assert.equal(stepVideoZoom(1.25, -1), 1)
  assert.equal(stepVideoZoom(1.4, 1), 1.5)
  assert.equal(stepVideoZoom(1.4, -1), 1.25)

  assert.equal(stepVideoZoom(1, -1), 1)
  assert.equal(stepVideoZoom(3, 1), 3)
})

test('zoom levels are formatted as percentages', () => {
  assert.equal(formatVideoZoom(1), '100%')
  assert.equal(formatVideoZoom(1.25), '125%')
  assert.equal(formatVideoZoom(1.403), '140%')
  assert.equal(formatVideoZoom(3), '300%')
})

test('pinch zoom keeps the gesture focal point over the same video content', () => {
  assert.deepEqual(resolveVideoZoomPinch({
    startZoom: 1,
    startOffset: { x: 0, y: 0 },
    startFocal: { x: -100, y: 0 },
    focal: { x: -100, y: 0 },
    scale: 2,
    size: { width: 400, height: 200 }
  }), {
    zoom: 2,
    offset: { x: 0.5, y: 0 }
  })
})

test('pinch zoom clamps zoom and panning to the supported crop', () => {
  assert.deepEqual(resolveVideoZoomPinch({
    startZoom: 2,
    startOffset: { x: 1, y: -1 },
    startFocal: { x: 0, y: 0 },
    focal: { x: 500, y: -500 },
    scale: 10,
    size: { width: 400, height: 200 }
  }), {
    zoom: 3,
    offset: { x: 1, y: -1 }
  })
})
