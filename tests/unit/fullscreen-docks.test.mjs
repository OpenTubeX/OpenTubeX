import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getFullscreenDockCollapseNeighbor,
  getFullscreenDockCollapsedWeight,
  toggleFullscreenDockCollapsed,
} from '../../src/renderer/helpers/fullscreenDocks.js'

const CONTAINER_HEIGHT = 1080

/**
 * @param {string[]} openDocks
 */
function createStack(openDocks) {
  return {
    openDocks,
    weights: Object.fromEntries(openDocks.map(dock => [dock, 1])),
    collapsedState: Object.fromEntries(openDocks.map(dock => [dock, null])),
  }
}

/**
 * @param {{ openDocks: string[], weights: Record<string, number>, collapsedState: object }} stack
 * @param {string} dock
 */
function toggle(stack, dock) {
  return toggleFullscreenDockCollapsed(
    stack.openDocks,
    dock,
    stack.weights,
    stack.collapsedState,
    CONTAINER_HEIGHT
  )
}

test('collapsing a dock hands its height to a neighbour and expanding takes it back', () => {
  const stack = createStack(['metadata', 'transcript'])

  assert.equal(toggle(stack, 'metadata'), true)
  assert.equal(
    stack.weights.metadata,
    getFullscreenDockCollapsedWeight(stack.openDocks, 'metadata', stack.weights, CONTAINER_HEIGHT)
  )
  assert.ok(stack.weights.transcript > 1)
  assert.equal(stack.collapsedState.metadata.neighbor, 'transcript')

  assert.equal(toggle(stack, 'metadata'), true)
  assert.equal(stack.collapsedState.metadata, null)
  assert.deepEqual(stack.weights, { metadata: 1, transcript: 1 })
})

test('a collapsing dock skips neighbours that are already collapsed', () => {
  const stack = createStack(['metadata', 'transcript', 'comments'])

  toggle(stack, 'transcript')
  assert.equal(stack.collapsedState.transcript.neighbor, 'comments')

  // `metadata`'s nearest neighbour is collapsed, so it must look further along
  toggle(stack, 'metadata')
  assert.equal(stack.collapsedState.metadata.neighbor, 'comments')
  assert.ok(stack.weights.transcript < 0.5, 'the collapsed dock stays collapsed')
})

test('the last expanded dock cannot be collapsed', () => {
  const stack = createStack(['metadata', 'transcript'])

  toggle(stack, 'metadata')
  assert.equal(getFullscreenDockCollapseNeighbor(stack.openDocks, 'transcript', stack.collapsedState), null)
  assert.equal(toggle(stack, 'transcript'), false)
  assert.equal(stack.collapsedState.transcript, null)
})

test('expanding a dock never drives another one below its collapsed height', () => {
  const stack = createStack(['metadata', 'transcript', 'comments'])

  // `metadata` lends its height to `transcript`, which then lends everything it
  // has - its own share plus the borrowed one - on to `comments`
  toggle(stack, 'metadata')
  toggle(stack, 'transcript')

  // Expanding `metadata` used to reclaim its height from `transcript`, which no
  // longer had it, leaving `transcript` with a negative weight so the docks
  // overlapped and rendered upside down
  toggle(stack, 'metadata')

  for (const dock of stack.openDocks) {
    assert.ok(
      stack.weights[dock] >= getFullscreenDockCollapsedWeight(stack.openDocks, dock, stack.weights, CONTAINER_HEIGHT) - 1e-9,
      `${dock} shrank below its collapsed height: ${stack.weights[dock]}`
    )
  }
  assert.equal(stack.weights.metadata, 1)

  // The stack still lays out top to bottom without overlaps
  const totalWeight = stack.openDocks.reduce((total, dock) => total + stack.weights[dock], 0)
  let weightBefore = 0
  for (const dock of stack.openDocks) {
    const start = weightBefore / totalWeight
    const end = (weightBefore + stack.weights[dock]) / totalWeight
    assert.ok(start < end, `${dock} has no height`)
    weightBefore += stack.weights[dock]
  }
})

test('expanding both collapsed docks again restores the original layout', () => {
  const stack = createStack(['metadata', 'transcript', 'comments'])

  // Collapsing the first hands its height to the second, and collapsing the
  // second then hands both on to the third
  toggle(stack, 'metadata')
  toggle(stack, 'transcript')

  // Expanding them back used to let the second dock reclaim the height the first
  // one had already taken back, squeezing the third down to its collapsed size
  // while nothing marked it collapsed - so double-clicking it collapsed it
  // instead of expanding it, with no way back to the even split.
  toggle(stack, 'metadata')
  toggle(stack, 'transcript')

  for (const dock of stack.openDocks) {
    assert.ok(
      Math.abs(stack.weights[dock] - 1) < 1e-9,
      `${dock} ended up at ${stack.weights[dock]} instead of an even third`
    )
  }
  assert.deepEqual(stack.collapsedState, { metadata: null, transcript: null, comments: null })
})

test('any collapse and expand order restores the layout it started from', () => {
  const permutations = (items) => items.length <= 1
    ? [items]
    : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)])
      .map(rest => [item, ...rest]))

  const openDocks = ['metadata', 'transcript', 'comments', 'playlist']
  // An unevenly resized stack, as the divider drags leave it
  const start = { metadata: 1.4, transcript: 0.7, comments: 1.9, playlist: 1 }
  const startTotal = Object.values(start).reduce((total, weight) => total + weight, 0)

  for (const collapseOrder of permutations(openDocks)) {
    for (let count = 1; count < openDocks.length; count++) {
      const collapsed = collapseOrder.slice(0, count)

      for (const expandOrder of permutations(collapsed)) {
        const stack = { openDocks, weights: { ...start }, collapsedState: Object.fromEntries(openDocks.map(dock => [dock, null])) }
        for (const dock of collapsed) { toggle(stack, dock) }
        for (const dock of expandOrder) { toggle(stack, dock) }

        const total = Object.values(stack.weights).reduce((sum, weight) => sum + weight, 0)
        for (const dock of openDocks) {
          assert.ok(
            Math.abs(stack.weights[dock] / total - start[dock] / startTotal) < 1e-9,
            `collapse [${collapsed}] then expand [${expandOrder}] left ${dock} at ` +
            `${(stack.weights[dock] / total).toFixed(4)} instead of ${(start[dock] / startTotal).toFixed(4)}`
          )
          assert.equal(stack.collapsedState[dock], null, `${dock} kept a stale collapsed flag`)
        }
      }
    }
  }
})

test('a collapsed dock can still be expanded after its sibling is closed', () => {
  const stack = createStack(['metadata', 'transcript'])

  toggle(stack, 'metadata')

  // The user closes the transcript panel outright, leaving the collapsed
  // metadata dock on its own. A lone dock fills the height whatever its weight,
  // so nothing looks wrong until a second dock opens again - at which point it
  // must not snap back to the sliver it was collapsed to.
  stack.openDocks = ['metadata']
  assert.equal(toggle(stack, 'metadata'), true)
  assert.equal(stack.collapsedState.metadata, null)
  assert.equal(stack.weights.metadata, 1)
})

test('a lone dock cannot be collapsed, as there is nowhere to put its height', () => {
  const stack = createStack(['metadata'])

  assert.equal(toggle(stack, 'metadata'), false)
  assert.equal(stack.collapsedState.metadata, null)
  assert.equal(stack.weights.metadata, 1)
})

test('toggling does not touch a stack it is not part of', () => {
  const stack = createStack(['metadata', 'transcript'])
  const weightsBefore = { ...stack.weights }
  const collapsedStateBefore = { ...stack.collapsedState }

  assert.equal(toggleFullscreenDockCollapsed(
    stack.openDocks, 'comments', stack.weights, stack.collapsedState, CONTAINER_HEIGHT
  ), false)
  assert.deepEqual(stack.weights, weightsBefore)
  // Including not recording a collapsed entry for a dock that is not in the stack
  assert.deepEqual(stack.collapsedState, collapsedStateBefore)
})
