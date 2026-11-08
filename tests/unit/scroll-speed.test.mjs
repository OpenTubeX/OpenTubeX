import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeScrollSpeed
} from '../../src/renderer/helpers/scrollSpeed.js'

test('clamps scroll speed to the supported range', () => {
  assert.equal(normalizeScrollSpeed(10), 25)
  assert.equal(normalizeScrollSpeed(25), 25)
  assert.equal(normalizeScrollSpeed(100), 100)
  assert.equal(normalizeScrollSpeed('200'), 200)
  assert.equal(normalizeScrollSpeed(300), 300)
  assert.equal(normalizeScrollSpeed(400), 300)
  assert.equal(normalizeScrollSpeed(0), 100)
  assert.equal(normalizeScrollSpeed(Number.NaN), 100)
})
