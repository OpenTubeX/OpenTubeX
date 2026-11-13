// @ts-check
import { KeyboardShortcuts } from '../../constants.js'
import { matchesKeyboardShortcut } from './keyboardShortcuts.js'

/**
 * Provided by FtAutoGrid. Tiles only take their keyboard shortcuts inside a
 * grid, so tiles elsewhere, such as beside the video player, keep its keys.
 */
export const tileKeyboardShortcutsKey = Symbol('tileKeyboardShortcuts')

// Controls inside a tile that use arrow keys or letters themselves.
const NESTED_CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], .iconDropdown'
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
// Fractional UI Scale values can offset tiles of one row by a subpixel.
const ROW_TOLERANCE = 1
// Room for the focus ring that items draw outside their edges.
const SCROLL_MARGIN = 8

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function isTileKeyboardEvent(event) {
  const target = event.target
  return !event.defaultPrevented &&
    target instanceof HTMLElement &&
    !target.isContentEditable &&
    target.closest(NESTED_CONTROL_SELECTOR) === null
}

/**
 * Whether the event should mark the tile that has focus as seen, or toggle
 * it as watched.
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isTileMarkShortcut(event) {
  return !event.repeat &&
    isTileKeyboardEvent(event) &&
    matchesKeyboardShortcut(event, KeyboardShortcuts.APP.SITUATIONAL.MARK_SEEN_OR_WATCHED)
}

/** @typedef {'up' | 'down' | 'previous' | 'next'} TileDirection */

/**
 * @param {KeyboardEvent} event
 * @param {boolean} rtl
 * @returns {TileDirection | null}
 */
export function getTileDirection(event, rtl) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !isTileKeyboardEvent(event)) {
    return null
  }

  switch (event.key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    case 'ArrowLeft':
      return rtl ? 'next' : 'previous'
    case 'ArrowRight':
      return rtl ? 'previous' : 'next'
    default:
      return null
  }
}

/**
 * Finds the tile an arrow key moves to. Left and right follow the tile order,
 * so they wrap between rows. Up and down pick the tile in the neighboring row
 * whose horizontal center is closest.
 * @param {{ top: number, bottom: number, left: number, right: number }[]} rects
 * @param {number} index
 * @param {TileDirection} direction
 * @returns {number} -1 when there is no tile in that direction
 */
export function findAdjacentTileIndex(rects, index, direction) {
  if (direction === 'previous') {
    return index - 1
  }
  if (direction === 'next') {
    return index + 1 < rects.length ? index + 1 : -1
  }

  const current = rects[index]
  const down = direction === 'down'
  const candidates = rects
    .map((rect, rectIndex) => ({ rect, rectIndex }))
    .filter(({ rect }) => down
      ? rect.top >= current.bottom - ROW_TOLERANCE
      : rect.bottom <= current.top + ROW_TOLERANCE)

  if (candidates.length === 0) {
    return -1
  }

  const rowTops = candidates.map(({ rect }) => rect.top)
  const rowTop = down ? Math.min(...rowTops) : Math.max(...rowTops)
  const center = (current.left + current.right) / 2
  let closest = -1
  let closestDistance = Infinity
  for (const { rect, rectIndex } of candidates) {
    if (Math.abs(rect.top - rowTop) > ROW_TOLERANCE) continue
    const distance = Math.abs((rect.left + rect.right) / 2 - center)
    if (distance < closestDistance) {
      closest = rectIndex
      closestDistance = distance
    }
  }
  return closest
}

/**
 * @param {Element} tile
 * @returns {boolean}
 */
export function isTileLeaving(tile) {
  return !tile.isConnected || tile.classList.contains('feed-leave-active')
}

/**
 * The tiles of every visible grid on the page in document order, so focus can
 * move between grids, such as the categories of the New feed.
 * @param {Element} grid
 * @returns {Element[]}
 */
export function getPageTiles(grid) {
  const page = grid.closest('.tabContent') ?? document.body
  return Array.from(page.querySelectorAll('.autoGrid'))
    .filter(pageGrid => pageGrid.closest('[inert]') === null && pageGrid.checkVisibility())
    .flatMap(pageGrid => Array.from(pageGrid.children))
}

/**
 * Lazy tiles render their content only once they scroll into view.
 * @param {Element} tile
 * @returns {boolean}
 */
function isLazyTile(tile) {
  return tile.hasAttribute('data-feed-item-key')
}

/**
 * Whether focus can move to the tile. Placeholders, such as skeleton cards,
 * have nothing to focus.
 * @param {Element} tile
 * @returns {boolean}
 */
export function isTileFocusable(tile) {
  return !isTileLeaving(tile) && (getTileFocusTarget(tile) !== null || isLazyTile(tile))
}

/**
 * The title link of a tile, or its first focusable control. A post's
 * attached video is part of the post, so its title does not count.
 * @param {Element} tile
 * @returns {HTMLElement | null}
 */
function getTileFocusTarget(tile) {
  const candidates = [
    ...Array.from(tile.querySelectorAll('a.title[href]')).filter(title => title.closest('.ft-list-post') === null),
    ...tile.querySelectorAll(FOCUSABLE_SELECTOR),
  ]
  // A blocked item covers its content, which leaves only its reveal button.
  const target = candidates.find(element => element.closest('.grabBar, [inert], [aria-hidden="true"]') === null)
  return target instanceof HTMLElement ? target : null
}

// A newer focus request, such as another arrow key, replaces a pending one.
let cancelPendingTileFocus = () => {}

/**
 * Focuses a tile and scrolls it fully into view, below sticky headers.
 * @param {Element} tile
 * @returns {boolean} false when the tile has nothing to focus
 */
export function focusTile(tile) {
  cancelPendingTileFocus()
  const target = getTileFocusTarget(tile)
  if (target !== null) {
    target.focus({ preventScroll: true })
    revealTile(tile)
    return true
  }
  if (!isLazyTile(tile)) {
    return false
  }

  // Scrolling the tile into view mounts its content, which then takes focus
  // unless focus has moved on since, such as with a click.
  const previousFocus = document.activeElement
  const observer = new MutationObserver(() => {
    const mountedTarget = getTileFocusTarget(tile)
    if (mountedTarget === null) return
    cancelPendingTileFocus()
    if (document.activeElement !== previousFocus) return
    mountedTarget.focus({ preventScroll: true })
    revealTile(tile)
  })
  const timeout = setTimeout(() => cancelPendingTileFocus(), 1000)
  cancelPendingTileFocus = () => {
    observer.disconnect()
    clearTimeout(timeout)
    cancelPendingTileFocus = () => {}
  }
  observer.observe(tile, { childList: true, subtree: true })
  revealTile(tile)
  return true
}

/**
 * Scrolls the tile fully into view, with room for its focus ring. Unlike
 * scrollIntoView, this keeps it clear of sticky headers, such as the top
 * navigation and the Subscriptions header.
 * @param {Element} tile
 */
function revealTile(tile) {
  const rect = tile.getBoundingClientRect()
  const top = getStickyHeaderBottom(tile, (rect.left + rect.right) / 2) + SCROLL_MARGIN
  const bottom = window.innerHeight - SCROLL_MARGIN
  if (rect.top < top) {
    window.scrollBy({ top: rect.top - top, behavior: 'instant' })
  } else if (rect.bottom > bottom) {
    // A tile taller than the space keeps its top in view.
    window.scrollBy({ top: Math.min(rect.bottom - bottom, rect.top - top), behavior: 'instant' })
  }
}

/**
 * The bottom edge of the sticky or fixed headers stacked at the top of the
 * window above the given column.
 * @param {Element} tile
 * @param {number} x
 * @returns {number}
 */
function getStickyHeaderBottom(tile, x) {
  let bottom = 0
  // Stacked headers, such as the top navigation and a page header below it.
  for (let depth = 0; depth < 4; depth++) {
    const element = document.elementFromPoint(x, bottom + ROW_TOLERANCE)
    const header = element === null ? null : getStickyAncestor(element, tile)
    if (header === null) break
    bottom = header.getBoundingClientRect().bottom
  }
  return bottom
}

/**
 * @param {Element} element
 * @param {Element} tile
 * @returns {Element | null}
 */
function getStickyAncestor(element, tile) {
  /** @type {Element | null} */
  let current = element
  while (current !== null && !current.contains(tile)) {
    const position = getComputedStyle(current).position
    if (position === 'sticky' || position === 'fixed') {
      return current
    }
    current = current.parentElement
  }
  return null
}
