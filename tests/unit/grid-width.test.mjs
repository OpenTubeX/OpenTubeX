import assert from 'node:assert/strict'
import test from 'node:test'

import {
  measureStableGridWidth
} from '../../src/renderer/components/FtAutoGrid/gridWidth.js'

test('remembers scrollbar width after the document stops overflowing', () => {
  const overflowing = measureStableGridWidth(1656, 0, null, 2021, 2005)
  const fitting = measureStableGridWidth(
    1672,
    overflowing.scrollbarWidth,
    overflowing.viewportWidth,
    2021,
    2021
  )

  assert.deepEqual(overflowing, {
    gridWidth: 1656,
    scrollbarWidth: 16,
    viewportWidth: 2021
  })
  assert.deepEqual(fitting, {
    gridWidth: 1656,
    scrollbarWidth: 16,
    viewportWidth: 2021
  })
  assert.equal(overflowing.gridWidth, fitting.gridWidth)
})

test('does not compensate an already padded scroll lock', () => {
  const measurement = measureStableGridWidth(
    1656,
    16,
    2021,
    2021,
    2021,
    true
  )

  assert.equal(measurement.gridWidth, 1656)
})

test('refreshes a smaller visible scrollbar width', () => {
  const measurement = measureStableGridWidth(
    1500,
    16,
    2021,
    2021,
    2011
  )

  assert.equal(measurement.scrollbarWidth, 10)
})

test('forgets stale scrollbar width after viewport scaling changes', () => {
  const measurement = measureStableGridWidth(
    1500,
    16,
    2021,
    1800,
    1800
  )

  assert.equal(measurement.gridWidth, 1500)
  assert.equal(measurement.scrollbarWidth, 0)
})
