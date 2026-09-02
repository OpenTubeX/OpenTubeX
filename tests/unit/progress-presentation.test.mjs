import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldShowProgressStartToast,
  shouldUseProgressToast,
} from '../../src/renderer/helpers/progressPresentation.js'

test('desktop follows the progress notification preference', () => {
  assert.equal(shouldUseProgressToast(true, false), true)
  assert.equal(shouldShowProgressStartToast(true, false), false)
  assert.equal(shouldUseProgressToast(false, false), false)
  assert.equal(shouldShowProgressStartToast(false, false), true)
})

test('Capacitor always uses the global bar without a start toast', () => {
  for (const preference of [true, false]) {
    assert.equal(shouldUseProgressToast(preference, true), false)
    assert.equal(shouldShowProgressStartToast(preference, true), false)
  }
})
