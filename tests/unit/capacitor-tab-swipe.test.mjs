import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldCloseSwipedTab } from '../../src/renderer/helpers/capacitorTabSwipe.js'

test('closes a tab after a deliberate long swipe', () => {
  assert.equal(shouldCloseSwipedTab({ distance: 110, elapsed: 700, width: 300 }), true)
})

test('closes a tab after a short fast fling', () => {
  assert.equal(shouldCloseSwipedTab({ distance: -40, elapsed: 50, width: 300 }), true)
})

test('keeps a tab after a short slow movement', () => {
  assert.equal(shouldCloseSwipedTab({ distance: 30, elapsed: 500, width: 300 }), false)
})
