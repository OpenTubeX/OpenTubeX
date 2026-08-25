import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCurrentShiftedTabIds,
  buildShiftedTabIds,
  computeTabOffsets,
  getDraggedTabIds,
  getTabIndexShift
} from '../../src/renderer/components/TabBar/tabReorder.js'
import { reconcilePendingTabOrder } from '../../src/renderer/tabs/pendingTabOrder.js'

const tabs = [
  { id: 'a', isPinned: true },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' },
  { id: 'e' }
]

test('shifts selected tabs together without collapsing the gaps between them', () => {
  const draggedTabIds = getDraggedTabIds(tabs, new Set(['b', 'd']), 'd')
  const reorderedTabIds = buildShiftedTabIds(
    tabs.map(tab => tab.id),
    draggedTabIds,
    1
  )

  assert.deepEqual(draggedTabIds, ['b', 'd'])
  assert.deepEqual(reorderedTabIds, ['a', 'c', 'b', 'e', 'd'])
})

test('dragging an unselected tab leaves the selection out of the drag', () => {
  assert.deepEqual(getDraggedTabIds(tabs, new Set(['b', 'd']), 'c'), ['c'])
})

test('keeps pinned and unpinned selected tabs in separate drag groups', () => {
  assert.deepEqual(getDraggedTabIds(tabs, new Set(['a', 'b']), 'b'), ['b'])
  assert.deepEqual(getDraggedTabIds(tabs, new Set(['a', 'b']), 'a'), ['a'])
})

test('clamps shared index shifts to the pinned boundary and selected tab edges', () => {
  const rects = tabs.map((tab, index) => ({
    id: tab.id,
    start: index * 102,
    size: 100
  }))

  assert.equal(getTabIndexShift(rects, new Set(['a']), 0, 1000, 0, 0), 0)
  assert.equal(getTabIndexShift(rects, new Set(['b', 'd']), 3, 0, 1, 4), 0)
  assert.equal(getTabIndexShift(rects, new Set(['c', 'e']), 4, 356, 1, 4), -1)
  assert.equal(getTabIndexShift(rects, new Set(['b', 'd']), 1, 1000, 1, 4), 1)
})

test('computes offsets for the final spacing-preserving order', () => {
  const rects = tabs.map((tab, index) => ({
    id: tab.id,
    start: index * 102,
    size: 100
  }))
  const offsets = computeTabOffsets(rects, ['a', 'c', 'b', 'e', 'd'], 2)

  assert.deepEqual(offsets, {
    c: -102,
    b: 102,
    e: -102,
    d: 102
  })
})

test('reconciles a pending drag with tabs opened or closed while settling', () => {
  assert.deepEqual(
    buildCurrentShiftedTabIds(
      [...tabs, { id: 'f' }],
      ['b', 'd'],
      1,
      false
    ),
    ['a', 'c', 'b', 'e', 'd', 'f']
  )
  assert.deepEqual(
    buildCurrentShiftedTabIds(
      tabs.filter(tab => tab.id !== 'd'),
      ['b', 'd'],
      1,
      false
    ),
    ['a', 'c', 'b', 'e']
  )
  assert.deepEqual(
    buildCurrentShiftedTabIds(
      [{ id: 'p', isPinned: true }, ...tabs],
      ['b', 'd'],
      -10,
      false
    ),
    ['p', 'a', 'b', 'c', 'd', 'e']
  )
})

test('keeps the newest local order through stale reorder acknowledgments', () => {
  const firstOrder = [tabs[2], tabs[3], tabs[0], tabs[1], tabs[4]]
  const newestOrderIds = ['a', 'b', 'e', 'c', 'd']

  const staleAcknowledgment = reconcilePendingTabOrder(firstOrder, newestOrderIds)
  assert.deepEqual(staleAcknowledgment.tabs.map(tab => tab.id), newestOrderIds)
  assert.deepEqual(staleAcknowledgment.pendingTabOrder, newestOrderIds)

  const finalAcknowledgment = reconcilePendingTabOrder(
    newestOrderIds.map(id => tabs.find(tab => tab.id === id)),
    newestOrderIds
  )
  assert.deepEqual(finalAcknowledgment.tabs.map(tab => tab.id), newestOrderIds)
  assert.equal(finalAcknowledgment.pendingTabOrder, null)
})

test('reconciles opened and closed tabs into a pending local order', () => {
  const result = reconcilePendingTabOrder(
    [...tabs.filter(tab => tab.id !== 'c'), { id: 'f' }],
    ['a', 'c', 'b', 'e', 'd']
  )

  assert.deepEqual(result.tabs.map(tab => tab.id), ['a', 'b', 'e', 'd', 'f'])
  assert.deepEqual(result.pendingTabOrder, ['a', 'b', 'e', 'd', 'f'])
})

test('accepts the authoritative order when a pending reorder is rejected', () => {
  const authoritativeTabs = [tabs[0], tabs[1], { id: 'f' }, tabs[2], tabs[3], tabs[4]]
  const result = reconcilePendingTabOrder(
    authoritativeTabs,
    ['a', 'c', 'b', 'e', 'd'],
    true
  )

  assert.equal(result.tabs, authoritativeTabs)
  assert.equal(result.pendingTabOrder, null)
})
