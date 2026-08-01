import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getVideoRect
} from '../../src/renderer/components/FtVideoAnnotations/annotationSurface.js'

test('uses the full player for video with the same aspect ratio', () => {
  assert.deepEqual(getVideoRect(1600, 900, 16 / 9), {
    left: 0,
    top: 0,
    width: 1600,
    height: 900
  })
})

test('keeps annotations inside the pillarboxes of a 4:3 video', () => {
  assert.deepEqual(getVideoRect(1600, 900, 4 / 3), {
    left: 200,
    top: 0,
    width: 1200,
    height: 900
  })
})

test('keeps annotations inside the letterboxes of an ultrawide video', () => {
  assert.deepEqual(getVideoRect(1600, 900, 32 / 9), {
    left: 0,
    top: 225,
    width: 1600,
    height: 450
  })
})

test('centers annotations when a fullscreen dock narrows the video viewport', () => {
  assert.deepEqual(getVideoRect(1440, 1080, 16 / 9), {
    left: 0,
    top: 135,
    width: 1440,
    height: 810
  })
})

test('extends the annotation surface through cropped cover content', () => {
  assert.deepEqual(getVideoRect(1600, 900, 4 / 3, 'cover'), {
    left: 0,
    top: -150,
    width: 1600,
    height: 1200
  })

  assert.deepEqual(getVideoRect(1600, 900, 32 / 9, 'cover'), {
    left: -800,
    top: 0,
    width: 3200,
    height: 900
  })
})

test('falls back until valid video dimensions are available', () => {
  assert.equal(getVideoRect(1600, 900, null), null)
  assert.equal(getVideoRect(0, 900, 4 / 3), null)
})
