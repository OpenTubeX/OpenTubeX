import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { ref } from 'vue'
import { handleDragAndDrop } from '../../src/renderer/helpers/dragAndDrop.js'

const source = readFileSync(new URL('../../src/renderer/composables/usePlaylistDrag.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replace('export function', 'function')

function createDrag() {
  const moves = []
  const listeners = new Map()
  const frames = new Map()
  let time = 1000
  let frameId = 0
  let target = null
  let captured = false
  let cleanup
  const list = {
    parentElement: null,
    setPointerCapture() { captured = true },
    hasPointerCapture() { return captured },
    releasePointerCapture() { captured = false },
    addEventListener(name, callback) { listeners.set(name, callback) },
    removeEventListener(name) { listeners.delete(name) }
  }
  const row = index => ({
    parentElement: list,
    dataset: { videoId: `video-${index}`, playlistItemId: `item-${index}` },
    closest() { return this }
  })
  const rows = [row(0), row(1), row(2)]
  const api = vm.runInNewContext(`${source}\nusePlaylistDrag(emit)`, {
    ref,
    onBeforeUnmount(callback) { cleanup = callback },
    handleDragAndDrop,
    emit(name, ...args) { moves.push({ name, args }) },
    performance: { now: () => time },
    getComputedStyle: () => ({ overflowY: 'visible' }),
    document: { elementFromPoint: () => target, scrollingElement: { scrollBy() {} } },
    window: { innerWidth: 800, innerHeight: 1000 },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) }
  })
  const event = type => ({
    type, pointerId: 4, pointerType: 'touch', isPrimary: true, button: 0,
    currentTarget: rows[0], target: { closest: () => ({}) }, clientX: 400, clientY: 400,
    preventDefault() {}, stopPropagation() {}
  })
  api.startPointerDrag(event('pointerdown'), { videoId: 'video-0', playlistItemId: 'item-0' })
  return {
    api, moves, frames, listeners, cleanup,
    move(index, at) { target = rows[index]; time = at; listeners.get('pointermove')(event('pointermove')) },
    end(type = 'pointerup') { listeners.get(type)(event(type)) },
    frame(at) {
      time = at
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(at))
    },
    destinations: () => moves.filter(move => move.name === 'move-dragged-video').map(move => move.args[0].playlistItemId)
  }
}

test('retries the latest touch destination when the finger stops inside the playlist', () => {
  const drag = createDrag()
  drag.move(1, 1000)
  drag.move(2, 1050)
  assert.deepEqual(drag.destinations(), ['item-1'])
  drag.frame(1101)
  assert.deepEqual(drag.destinations(), ['item-1', 'item-2'])
  assert.equal(drag.frames.size, 0)
  drag.end()
})

test('pointer release flushes a fast final destination before saving the order', () => {
  const drag = createDrag()
  drag.move(1, 1000)
  drag.move(2, 1050)
  drag.end()
  assert.deepEqual(drag.destinations(), ['item-1', 'item-2'])
  assert.equal(drag.moves.at(-1).name, 'drag-video-end')
  assert.equal(drag.moves[1].args[1].pointerDragging, true, 'parent can bypass its native drag throttle')
  assert.equal(drag.listeners.size, 0)
  assert.equal(drag.frames.size, 0)
  assert.equal(drag.api.pointerDragging.value, false)
})

test('cancellation discards a pending touch destination and releases drag resources', () => {
  const drag = createDrag()
  drag.move(1, 1000)
  drag.move(2, 1050)
  drag.end('pointercancel')
  assert.deepEqual(drag.destinations(), ['item-1'])
  assert.equal(drag.listeners.size, 0)
  assert.equal(drag.frames.size, 0)
  drag.cleanup()
  assert.equal(drag.moves.filter(move => move.name === 'drag-video-end').length, 1)
})
