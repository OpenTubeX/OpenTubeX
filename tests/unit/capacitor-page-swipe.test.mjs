import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findSwipeTab, shouldFinishPageSwipe } from '../../src/renderer/helpers/capacitorPageSwipe.js'

test('swiping visits adjacent unloaded and mounting tabs without skipping', () => {
  const tabs = [
    { id: 'first', loadState: 'loaded' },
    { id: 'unloaded', loadState: 'unloaded' },
    { id: 'mounting', loadState: 'mounting' },
    { id: 'last', loadState: 'loaded' }
  ]

  assert.equal(findSwipeTab(tabs, 'first', 1)?.id, 'unloaded')
  assert.equal(findSwipeTab(tabs, 'last', -1)?.id, 'mounting')
  assert.equal(findSwipeTab(tabs, 'last', 1), null)
  assert.equal(findSwipeTab(tabs, 'unloaded', 1), null)
})

test('page swipe settles on distance or a deliberate fling', () => {
  assert.equal(shouldFinishPageSwipe(-90, 300, 400), true)
  assert.equal(shouldFinishPageSwipe(40, 300, 50), true)
  assert.equal(shouldFinishPageSwipe(20, 300, 50), false)
  assert.equal(shouldFinishPageSwipe(50, 300, 500), false)
})
