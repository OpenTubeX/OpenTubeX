import assert from 'node:assert/strict'
import test from 'node:test'

import {
  measureStableGridWidth
} from '../../src/renderer/components/FtAutoGrid/gridWidth.js'

test('remembers scrollbar width after the document stops overflowing', () => {
  const overflowing = measureStableGridWidth(1656, 0, 2021, 2005)
  const fitting = measureStableGridWidth(
    1672,
    overflowing.scrollbarWidth,
    2021,
    2021
  )

  assert.deepEqual(overflowing, {
    gridWidth: 1640,
    scrollbarWidth: 16
  })
  assert.deepEqual(fitting, {
    gridWidth: 1656,
    scrollbarWidth: 16
  })
})
