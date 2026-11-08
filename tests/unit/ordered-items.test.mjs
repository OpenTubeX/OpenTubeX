import assert from 'node:assert/strict'
import test from 'node:test'

import { moveItemByVisibleOffset } from '../../src/orderedItems.js'

test('moves visible items without dropping unavailable entries', () => {
  assert.deepEqual(
    moveItemByVisibleOffset(
      ['home', 'trending', 'subscriptions', 'history'],
      ['home', 'subscriptions', 'history'],
      'subscriptions',
      -1
    ),
    ['subscriptions', 'home', 'trending', 'history']
  )
})
