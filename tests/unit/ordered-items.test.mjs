import assert from 'node:assert/strict'
import test from 'node:test'

import { moveItemByVisibleOffset, moveItemToRenderedOrder } from '../../src/orderedItems.js'

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

test('moves a dropped item next to its rendered neighbors and keeps unrendered ones', () => {
  const pins = ['a', 'hidden', 'b', 'c'].map(id => ({ id }))
  assert.deepEqual(
    moveItemToRenderedOrder(pins, pin => pin.id, 'c', ['c', 'a', 'b']).map(pin => pin.id),
    ['c', 'a', 'hidden', 'b']
  )
})

test('rejects a drop whose neighbor another window removed', () => {
  // Rendered [a, b, c] became [c, a, b], but the saved list no longer has a.
  const saved = [{ id: 'b' }, { id: 'c' }]
  assert.equal(moveItemToRenderedOrder(saved, pin => pin.id, 'c', ['c', 'a', 'b']), saved)
})
