import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findLoadedSwipeTab, shouldFinishPageSwipe } from '../../src/renderer/helpers/capacitorPageSwipe.js'

test('swiping skips unloaded tabs and stops at the loaded edge', () => {
  const tabs = [
    { id: 'first', loadState: 'loaded' },
    { id: 'unloaded', loadState: 'unloaded' },
    { id: 'mounting', loadState: 'mounting' },
    { id: 'last', loadState: 'loaded' }
  ]

  assert.equal(findLoadedSwipeTab(tabs, 'first', 1)?.id, 'last')
  assert.equal(findLoadedSwipeTab(tabs, 'last', -1)?.id, 'first')
  assert.equal(findLoadedSwipeTab(tabs, 'last', 1), null)
  assert.equal(findLoadedSwipeTab(tabs, 'unloaded', 1), null)
})

test('page swipe settles on distance or a deliberate fling', () => {
  assert.equal(shouldFinishPageSwipe(-90, 300, 400), true)
  assert.equal(shouldFinishPageSwipe(40, 300, 50), true)
  assert.equal(shouldFinishPageSwipe(20, 300, 50), false)
  assert.equal(shouldFinishPageSwipe(50, 300, 500), false)
})
