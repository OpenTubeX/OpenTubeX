import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref, watch } from 'vue'

import { computeReorderOffsets } from '../../src/renderer/helpers/reorderOffsets.js'
import { moveItemByVisibleOffset } from '../../src/orderedItems.js'

const source = readFileSync(new URL('../../src/renderer/composables/useOrderedItemReorder.js', import.meta.url), 'utf8')
  .replace(/^import .+\n/gm, '').replace('export function', 'function')

function createHarness({ items = ['a', 'b', 'c'], visible = items, saved = true } = {}) {
  const frames = new Map()
  let frameId = 0
  let time = 0
  const writes = []
  const announcements = []
  const scroller = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: -100, bottom: 300, height: 400, left: 0, right: 200 }),
    addEventListener() {}, removeEventListener() {},
    scrollBy({ top }) { this.scrollTop += top }
  }
  const rows = visible.map((id, index) => ({
    matches: () => true,
    getAttribute: () => id,
    getBoundingClientRect: () => ({ top: index * 48, height: 40, width: 200 }),
    getAnimations: () => []
  }))
  const list = { children: rows, parentElement: scroller }
  const handles = rows.map(row => ({
    closest: () => row,
    setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {}
  }))
  rows.forEach(row => { row.parentElement = list })
  const api = vm.runInNewContext(`${source}\nuseOrderedItemReorder(options)`, {
    ref, watch, nextTick, onBeforeUnmount() {},
    computeReorderOffsets, moveItemByVisibleOffset, isReducedMotionEnabled: () => true,
    options: {
      items: ref(items), rowSelector: '.row', itemIdAttribute: 'data-id',
      updateItems(order) { writes.push([...order]); return Promise.resolve(saved) },
      announceMoved(id, position) { announcements.push({ id, position }) }
    },
    getComputedStyle: element => ({ overflowY: element === scroller ? 'auto' : 'visible' }),
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    performance: { now: () => time },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) }
  })
  const event = y => ({ isPrimary: true, button: 0, pointerId: 1, clientX: 100, clientY: y, preventDefault() {} })
  return {
    api, frames, writes, announcements, scroller,
    start(index = 0) {
      api.startPointerDrag({ ...event(index * 48 + 20), currentTarget: handles[index] }, visible[index])
    },
    move: y => api.movePointerDrag(event(y)),
    drop: y => api.endPointerDrag(event(y)),
    frame() {
      time += 16
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(time))
    }
  }
}

test('idle drags stop frame work and restart scrolling when moved to an edge', () => {
  const drag = createHarness()
  drag.start()
  drag.move(70)
  drag.frame()
  assert.equal(drag.frames.size, 0, 'no continuous work away from an edge')
  assert.equal(drag.scroller.scrollTop, 0)
  drag.move(290)
  drag.frame()
  assert.ok(drag.scroller.scrollTop > 0)
  assert.equal(drag.frames.size, 1, 'holding near an edge continues scrolling')
  drag.move(100)
  drag.frame()
  assert.equal(drag.frames.size, 0, 'moving away stops scrolling again')
  drag.api.stopDragging()
})

test('failed settings writes do not announce a successful move', async () => {
  const drag = createHarness({ saved: false })
  drag.start()
  await drag.drop(70)
  assert.deepEqual(drag.writes, [['b', 'a', 'c']])
  assert.deepEqual(drag.announcements, [])
})

test('successful settings writes announce the visible destination', async () => {
  const drag = createHarness()
  drag.start()
  await drag.drop(70)
  assert.deepEqual(drag.announcements, [{ id: 'a', position: 1 }])
})

test('pointer reorders preserve hidden entries exactly like move buttons', async () => {
  const items = ['a', 'hidden', 'b', 'other-category', 'c']
  const visible = ['a', 'b', 'c']
  for (const [sourceIndex, destination] of [[0, 1], [0, 2], [2, 0], [1, 0]]) {
    const drag = createHarness({ items, visible })
    drag.start(sourceIndex)
    await drag.drop(destination * 48 + 20)
    assert.deepEqual(drag.writes, [moveItemByVisibleOffset(items, visible, visible[sourceIndex], destination - sourceIndex)])
    drag.api.stopDragging()
  }
})
