import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getContainedVideoRect
} from '../../src/renderer/components/FtVideoAnnotations/annotationSurface.js'

test('uses the full player for video with the same aspect ratio', () => {
  assert.deepEqual(getContainedVideoRect(1600, 900, 16 / 9), {
    left: 0,
    top: 0,
    width: 1600,
    height: 900
  })
})

test('keeps annotations inside the pillarboxes of a 4:3 video', () => {
  assert.deepEqual(getContainedVideoRect(1600, 900, 4 / 3), {
    left: 200,
    top: 0,
    width: 1200,
    height: 900
  })
})

test('keeps annotations inside the letterboxes of an ultrawide video', () => {
  assert.deepEqual(getContainedVideoRect(1600, 900, 32 / 9), {
    left: 0,
    top: 225,
    width: 1600,
    height: 450
  })
})

test('falls back until valid video dimensions are available', () => {
  assert.equal(getContainedVideoRect(1600, 900, null), null)
  assert.equal(getContainedVideoRect(0, 900, 4 / 3), null)
})
