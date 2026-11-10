import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_VIDEO_ZOOM,
  getVideoFillZoom,
  resolveVideoZoomPinch,
  sanitizeVideoZoom,
} from '../../src/renderer/helpers/player/videoZoom.js'

test('unusable values fall back to no zoom', () => {
  assert.equal(sanitizeVideoZoom(undefined), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom(null), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom('nonsense'), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom(NaN), DEFAULT_VIDEO_ZOOM)
  assert.equal(sanitizeVideoZoom(Infinity), DEFAULT_VIDEO_ZOOM)
})

test('fill zoom covers the player for wide and tall videos', () => {
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 1920, height: 1080 }), 1.125)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 1000, height: 1000 }), 2)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 400, height: 200 }), null)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 0, height: 0 }), null)
  assert.equal(getVideoFillZoom({ width: 400, height: 200 }, { width: 400, height: 200 }, { width: 9, height: 16 }), 32 / 9)
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
