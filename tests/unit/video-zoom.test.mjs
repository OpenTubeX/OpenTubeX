import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_VIDEO_ZOOM,
  formatVideoZoom,
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

test('values in between are snapped to the closest offered level', () => {
  assert.equal(sanitizeVideoZoom(1.4), 1.5)
  assert.equal(sanitizeVideoZoom(2.2), 2)
  // out of range values end up at the closest end
  assert.equal(sanitizeVideoZoom(0.2), 1)
  assert.equal(sanitizeVideoZoom(10), 3)
})

test('stepping moves one level at a time and stops at both ends', () => {
  assert.equal(stepVideoZoom(1, 1), 1.25)
  assert.equal(stepVideoZoom(1.25, -1), 1)
  // stale values are stepped relative to the level they snap to
  assert.equal(stepVideoZoom(1.4, 1), 1.75)

  assert.equal(stepVideoZoom(1, -1), 1)
  assert.equal(stepVideoZoom(3, 1), 3)
})

test('zoom levels are formatted as percentages', () => {
  assert.equal(formatVideoZoom(1), '100%')
  assert.equal(formatVideoZoom(1.25), '125%')
  assert.equal(formatVideoZoom(3), '300%')
})
