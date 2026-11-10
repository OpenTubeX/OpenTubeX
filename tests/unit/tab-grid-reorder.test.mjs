import assert from 'node:assert/strict'
import test from 'node:test'
import { getTabGridReorder } from '../../src/renderer/components/TabBar/tabGridReorder.js'

const rects = [
  { id: 'a', left: 12.5, top: 80.25 },
  { id: 'b', left: 192.75, top: 80.25 },
  { id: 'c', left: 12.5, top: 260.5 },
  { id: 'd', left: 192.75, top: 260.5 },
].map(rect => ({ ...rect, width: 168.25, height: 168.25, isPinned: false }))

test('neighbors shift through both rows while the dragged card stays under the pointer', () => {
  const result = getTabGridReorder(rects, 'a', 180.25, 180.25)
  assert.equal(result.targetIndex, 3)
  assert.deepEqual(result.offsets, {
    a: { x: 180.25, y: 180.25 },
    b: { x: -180.25, y: 0 },
    c: { x: 180.25, y: -180.25 },
    d: { x: -180.25, y: 0 },
  })
  assert.deepEqual(result.dropOffset, result.offsets.a)
})

test('pinned and unpinned cards cannot cross their group boundary', () => {
  const pinned = rects.map((rect, index) => ({ ...rect, isPinned: index < 2 }))
  assert.equal(getTabGridReorder(pinned, 'a', 0, 200).targetIndex, 0)
  assert.equal(getTabGridReorder(pinned, 'd', -180.25, -180.25).targetIndex, 2)
})
