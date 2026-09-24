import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_VIDEO_ZOOM,
  formatVideoZoom,
  getVideoFillZoom,
  getVideoFillZoomProximity,
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
  assert.equal(sanitizeVideoZoom(10), 8)
})

test('stepping moves one level at a time and stops at both ends', () => {
  assert.equal(stepVideoZoom(1, 1), 1.25)
  assert.equal(stepVideoZoom(1.25, -1), 1)
  assert.equal(stepVideoZoom(1.4, 1), 1.5)
  assert.equal(stepVideoZoom(1.4, -1), 1.25)

  assert.equal(stepVideoZoom(1, -1), 1)
  assert.equal(stepVideoZoom(3, 1), 3)
  assert.equal(stepVideoZoom(3.2, 1), 3.2)
  assert.equal(stepVideoZoom(3.2, -1), 3)
})

test('zoom levels are formatted as percentages', () => {
  assert.equal(formatVideoZoom(1), '100%')
  assert.equal(formatVideoZoom(1.25), '125%')
  assert.equal(formatVideoZoom(1.403), '140%')
  assert.equal(formatVideoZoom(3), '300%')
})

test('fill zoom covers the player for wide and tall videos', () => {
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 1920, height: 1080 }), 1.125)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 1000, height: 1000 }), 2)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 400, height: 200 }), null)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 0, height: 0 }), null)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 9, height: 16 }), 32 / 9)
})

test('fill zoom only arms the snap in a narrow band', () => {
  assert.deepEqual(getVideoFillZoomProximity(1.125, 1.125), { proximity: 1, snap: true })
  const near = getVideoFillZoomProximity(1.06, 1.125)
  assert.ok(Math.abs(near.proximity - 0.35) < 0.000001)
  assert.equal(near.snap, true)
  assert.deepEqual(getVideoFillZoomProximity(1, 1.125), { proximity: 0, snap: false })
  assert.deepEqual(getVideoFillZoomProximity(2, null), { proximity: 0, snap: false })
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

test('pinch zoom can reach a portrait video fill scale beyond the menu presets', () => {
  assert.equal(resolveVideoZoomPinch({
    startZoom: 1,
    startOffset: { x: 0, y: 0 },
    startFocal: { x: 0, y: 0 },
    focal: { x: 0, y: 0 },
    scale: 4,
    size: { width: 400, height: 200 },
    maximumZoom: 32 / 9,
  }).zoom, 32 / 9)
})
