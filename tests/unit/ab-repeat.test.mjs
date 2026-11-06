import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AbRepeatValidation,
  formatAbRepeatTimestamp,
  getAbRepeatBoundaryDelay,
  isCompleteAbRepeatRange,
  validateAbRepeatRange,
} from '../../src/renderer/helpers/player/abRepeat.js'

test('formats A-B repeat timestamps without losing millisecond precision', () => {
  assert.equal(formatAbRepeatTimestamp(75.25), '1:15.25')
  assert.equal(formatAbRepeatTimestamp(3723.005), '1:02:03.005')
  assert.equal(formatAbRepeatTimestamp(59.9996), '1:00')
  assert.equal(formatAbRepeatTimestamp(null), '')
})

test('validates the range order and video duration', () => {
  assert.equal(validateAbRepeatRange(10, 20, 60), null)
  assert.equal(validateAbRepeatRange(20, 10, 60), AbRepeatValidation.END_NOT_AFTER_START)
  assert.equal(validateAbRepeatRange(10, 61, 60), AbRepeatValidation.OUTSIDE_DURATION)
  assert.equal(isCompleteAbRepeatRange(10, 20, 60), true)
  assert.equal(isCompleteAbRepeatRange(10, null, 60), false)
})

test('accounts for playback rate when scheduling the B boundary', () => {
  assert.equal(getAbRepeatBoundaryDelay(10, 12, 1, 0), 2000)
  assert.equal(getAbRepeatBoundaryDelay(10, 12, 2, 0), 1000)
  assert.equal(getAbRepeatBoundaryDelay(13, 12, 1), 0)
})
