import assert from 'node:assert/strict'
import test from 'node:test'

import { findAdjacentTileIndex } from '../../src/renderer/helpers/tileNavigation.js'

function tile(left, top, width = 100, height = 80) {
  return { left, top, right: left + width, bottom: top + height }
}

// Three columns with a shorter last row, offset by a subpixel like fractional UI Scale layouts.
const grid = [
  tile(0, 0), tile(108, 0.4), tile(216, 0),
  tile(0, 88), tile(108, 88.3), tile(216, 88),
  tile(54, 176.2), tile(162, 176),
]

test('moves through tiles in order with left and right, wrapping between rows', () => {
  assert.equal(findAdjacentTileIndex(grid, 2, 'next'), 3)
  assert.equal(findAdjacentTileIndex(grid, 3, 'previous'), 2)
  assert.equal(findAdjacentTileIndex(grid, 0, 'previous'), -1)
  assert.equal(findAdjacentTileIndex(grid, 7, 'next'), -1)
})

test('moves to the closest tile in the neighboring row with up and down', () => {
  assert.equal(findAdjacentTileIndex(grid, 1, 'down'), 4)
  assert.equal(findAdjacentTileIndex(grid, 4, 'up'), 1)
  // A shorter last row still takes every column of the row above it.
  assert.equal(findAdjacentTileIndex(grid, 5, 'down'), 7)
  assert.equal(findAdjacentTileIndex(grid, 6, 'up'), 3)
  assert.equal(findAdjacentTileIndex(grid, 0, 'up'), -1)
  assert.equal(findAdjacentTileIndex(grid, 6, 'down'), -1)
})

test('moves one item at a time in a list', () => {
  const list = [tile(0, 0, 600), tile(0, 84, 600), tile(0, 168, 600)]

  assert.equal(findAdjacentTileIndex(list, 0, 'down'), 1)
  assert.equal(findAdjacentTileIndex(list, 2, 'up'), 1)
})
