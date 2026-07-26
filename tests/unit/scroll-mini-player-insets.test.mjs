import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getViewportInsets,
  getViewportWidth,
  snapScrollMiniPlayerToEdge,
  MARGIN
} from '../../src/renderer/helpers/scrollMiniPlayer.js'

/**
 * @param {object} options
 * @param {{ left: number, right: number } | null} [options.verticalTabBarRect]
 * @param {number} options.clientWidth usable width (excludes the scrollbar)
 * @param {number} [options.scrollbarWidth]
 */
function stubViewport({ verticalTabBarRect = null, clientWidth, scrollbarWidth = 0 }) {
  global.window = { innerWidth: clientWidth + scrollbarWidth, innerHeight: 800 }
  global.document = {
    querySelector(selector) {
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
