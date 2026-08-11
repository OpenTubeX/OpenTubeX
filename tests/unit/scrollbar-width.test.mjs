import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SCROLLBAR_THUMB_WIDTH,
  MAX_SCROLLBAR_THUMB_WIDTH,
  MIN_SCROLLBAR_THUMB_WIDTH,
  normalizeScrollbarThumbWidth
} from '../../src/renderer/constants/scrollbar.js'

test('keeps a usable scrollbar width within the slider bounds', () => {
  assert.equal(normalizeScrollbarThumbWidth(12), 12)
  assert.equal(normalizeScrollbarThumbWidth(MIN_SCROLLBAR_THUMB_WIDTH), MIN_SCROLLBAR_THUMB_WIDTH)
  assert.equal(normalizeScrollbarThumbWidth(MAX_SCROLLBAR_THUMB_WIDTH), MAX_SCROLLBAR_THUMB_WIDTH)
})

// The value ends up in a CSS length, where 0 hides every scrollbar and a huge
// number covers the content. Imports and syncs can carry either.
test('clamps a scrollbar width from outside the slider bounds', () => {
  assert.equal(normalizeScrollbarThumbWidth(0), MIN_SCROLLBAR_THUMB_WIDTH)
  assert.equal(normalizeScrollbarThumbWidth(-20), MIN_SCROLLBAR_THUMB_WIDTH)
  assert.equal(normalizeScrollbarThumbWidth(100), MAX_SCROLLBAR_THUMB_WIDTH)
})

test('falls back to the default for anything that is not a number', () => {
  for (const value of [undefined, null, '', 'wide', NaN, Infinity, {}]) {
    assert.equal(normalizeScrollbarThumbWidth(value), DEFAULT_SCROLLBAR_THUMB_WIDTH)
  }
})
