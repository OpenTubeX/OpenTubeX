import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getViewportInsets,
  getViewportWidth,
  snapScrollMiniPlayerToEdge,
  clampScrollMiniPlayerRect,
  parseScrollMiniPlayerSavedRect,
  serializeScrollMiniPlayerSavedRect,
  MARGIN
} from '../../src/renderer/helpers/scrollMiniPlayer.js'

/**
 * @param {object} options
 * @param {{ left: number, right: number } | null} [options.verticalTabBarRect]
 * @param {number} options.clientWidth usable width (excludes the scrollbar)
 * @param {number} [options.scrollbarWidth]
 */
function stubViewport ({ verticalTabBarRect = null, clientWidth, scrollbarWidth = 0 }) {
  global.window = { innerWidth: clientWidth + scrollbarWidth, innerHeight: 800 }
  global.document = {
    querySelector (selector) {
      if (selector === '.tabBar.vertical' && verticalTabBarRect) {
        return { getBoundingClientRect: () => verticalTabBarRect }
      }
      return null
    },
    documentElement: { clientWidth }
  }
}

test.afterEach(() => {
  delete global.document
  delete global.window
})

test('the usable viewport width excludes the vertical scrollbar', () => {
  stubViewport({ clientWidth: 1585, scrollbarWidth: 15 })

  assert.equal(getViewportWidth(), 1585)
})

test('docking to the inline-end leaves a margin clear of the scrollbar', () => {
  stubViewport({ clientWidth: 1585, scrollbarWidth: 15 })
  const insets = getViewportInsets()

  const snapped = snapScrollMiniPlayerToEdge(
    { left: 800, top: 100, width: 360, height: 202, dock: 'right' },
    insets
  )

  // The right edge must sit MARGIN away from the content edge, not be swallowed
  // by the scrollbar (regression: window.innerWidth left only a 1px gap).
  assert.equal(1585 - (snapped.left + snapped.width), MARGIN)
})

test('a vertical tab bar on the inline-start side pads the left inset', () => {
  stubViewport({ verticalTabBarRect: { left: 0, right: 220 }, clientWidth: 1000 })

  const insets = getViewportInsets()

  assert.equal(insets.left, 220 + MARGIN)
  assert.equal(insets.right, MARGIN)
})

test('a vertical tab bar on the right (RTL) pads the right inset instead', () => {
  stubViewport({ verticalTabBarRect: { left: 780, right: 1000 }, clientWidth: 1000 })

  const insets = getViewportInsets()

  assert.equal(insets.right, (1000 - 780) + MARGIN)
  assert.equal(insets.left, MARGIN)
})

test('without a vertical tab bar both inline insets stay at the margin', () => {
  stubViewport({ clientWidth: 1000 })

  const insets = getViewportInsets()

  assert.equal(insets.left, MARGIN)
  assert.equal(insets.right, MARGIN)
})

test('the left dock edge follows the tab rail width', () => {
  stubViewport({ verticalTabBarRect: { left: 0, right: 400 }, clientWidth: 1585 })
  const insets = getViewportInsets()

  const snapped = snapScrollMiniPlayerToEdge(
    { left: 236, top: 100, width: 360, height: 202, dock: 'left' },
    insets
  )

  // Regression: widening the rail used to strand the player at its old edge.
  assert.equal(snapped.left, 400 + MARGIN)
})

// Fits the 800px-tall stub viewport, so activation must preserve it verbatim.
const SAVED_RECT = { left: 1000, top: 400, width: 520, height: 292, dock: 'right' }

test('parsing a saved rect round-trips it without consulting the viewport', () => {
  const saved = serializeScrollMiniPlayerSavedRect(SAVED_RECT)

  // Restoring runs while the tab is still loading, so the viewport can be
  // unsized. Clamping here used to shrink the rect and pin it bottom-left, so
  // the parsed result must not vary with the viewport.
  stubViewport({ clientWidth: 0 })
  assert.deepEqual(parseScrollMiniPlayerSavedRect(saved), SAVED_RECT)

  stubViewport({ clientWidth: 300 })
  assert.deepEqual(parseScrollMiniPlayerSavedRect(saved), SAVED_RECT)
})

test('restoring while unsized then activating keeps the saved position and size', () => {
  const saved = serializeScrollMiniPlayerSavedRect(SAVED_RECT)

  // The restore/activation sequence: parse while the tab is still loading...
  stubViewport({ clientWidth: 0 })
  const restored = parseScrollMiniPlayerSavedRect(saved)

  // ...then activation clamps it, once layout has settled.
  stubViewport({ clientWidth: 1585, scrollbarWidth: 15 })
  const activated = clampScrollMiniPlayerRect(restored)

  assert.equal(activated.width, SAVED_RECT.width)
  assert.equal(activated.left, SAVED_RECT.left)
  assert.equal(activated.top, SAVED_RECT.top)
  assert.equal(activated.dock, 'right')
})

test('a restored rect that no longer fits is pulled back into view on activation', () => {
  const saved = serializeScrollMiniPlayerSavedRect(SAVED_RECT)

  stubViewport({ clientWidth: 0 })
  const restored = parseScrollMiniPlayerSavedRect(saved)

  // Saved against a wide window, reopened in a narrow one.
  stubViewport({ clientWidth: 600 })
  const activated = clampScrollMiniPlayerRect(restored)

  assert.ok(activated.left >= MARGIN, `left ${activated.left} should clear the margin`)
  assert.ok(
    activated.left + activated.width <= 600 - MARGIN,
    `right edge ${activated.left + activated.width} should stay inside the viewport`
  )
})

test('a malformed saved rect is rejected', () => {
  stubViewport({ clientWidth: 1585 })

  assert.equal(parseScrollMiniPlayerSavedRect(''), null)
  assert.equal(parseScrollMiniPlayerSavedRect('not json'), null)
  assert.equal(parseScrollMiniPlayerSavedRect(JSON.stringify({ left: 1 })), null)
  assert.equal(
    parseScrollMiniPlayerSavedRect(JSON.stringify({ left: NaN, top: 0, width: 1, height: 1 })),
    null
  )
})
