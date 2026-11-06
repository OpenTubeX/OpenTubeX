import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getNextTabBarPosition,
  isVerticalTabBarPosition,
  normalizeTabBarPosition,
} from '../../src/renderer/constants/tabBarPosition.js'

test('normalizes unsupported tab bar positions to the top layout', () => {
  assert.equal(normalizeTabBarPosition('right'), 'right')
  assert.equal(normalizeTabBarPosition('diagonal'), 'top')
})

test('recognizes both vertical positions', () => {
  assert.equal(isVerticalTabBarPosition('left'), true)
  assert.equal(isVerticalTabBarPosition('right'), true)
  assert.equal(isVerticalTabBarPosition('top'), false)
})

test('cycles through every tab bar position', () => {
  assert.equal(getNextTabBarPosition('top'), 'left')
  assert.equal(getNextTabBarPosition('left'), 'bottom')
  assert.equal(getNextTabBarPosition('bottom'), 'right')
  assert.equal(getNextTabBarPosition('right'), 'top')
})
