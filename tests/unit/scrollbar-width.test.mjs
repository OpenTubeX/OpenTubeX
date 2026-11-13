import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_SCROLLBAR_THUMB_WIDTH,
  MIN_SCROLLBAR_THUMB_WIDTH,
  normalizeScrollbarThumbWidth
} from '../../src/renderer/constants/scrollbar.js'

// The value ends up in a CSS length, where 0 hides every scrollbar and a huge
// number covers the content. Imports and syncs can carry either.
test('clamps a scrollbar width from outside the slider bounds', () => {
  assert.equal(normalizeScrollbarThumbWidth(0), MIN_SCROLLBAR_THUMB_WIDTH)
  assert.equal(normalizeScrollbarThumbWidth(-20), MIN_SCROLLBAR_THUMB_WIDTH)
  assert.equal(normalizeScrollbarThumbWidth(100), MAX_SCROLLBAR_THUMB_WIDTH)
})
