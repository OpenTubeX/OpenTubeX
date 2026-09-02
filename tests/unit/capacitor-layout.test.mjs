import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeCapacitorLayoutMode,
  usesCapacitorTabletLayout,
} from '../../src/renderer/helpers/capacitorLayout.js'

test('automatic Capacitor layout follows the tablet breakpoint', () => {
  assert.equal(usesCapacitorTabletLayout('auto', false), false)
  assert.equal(usesCapacitorTabletLayout('auto', true), true)
})

test('forced phone and tablet layouts ignore the viewport breakpoint', () => {
  assert.equal(usesCapacitorTabletLayout('phone', true), false)
  assert.equal(usesCapacitorTabletLayout('tablet', false), true)
})

test('unknown persisted layout values fall back to automatic mode', () => {
  assert.equal(normalizeCapacitorLayoutMode('desktop'), 'auto')
  assert.equal(usesCapacitorTabletLayout('desktop', true), true)
})
