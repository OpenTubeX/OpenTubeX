import { getThumbnailGridColumnCount } from '../constants/thumbnailSize'
import { getViewportHeight, getViewportWidth } from './viewport'

// The minimum block sizes of the row shells in FtListLazyWrapper.css.
const GRID_ITEM_MIN_HEIGHT = 264
const LIST_ITEM_MIN_HEIGHT = 131
// The row gaps of FtAutoGrid.css at the Default UI Density.
const GRID_ROW_GAP = 8
const LIST_ROW_GAP = 4
// Used before the window has a size.
const FALLBACK_ITEM_COUNT = 16

// Lists only show in pages, which share a container beside the side bar and
// any vertical tab bar. Its resize observer reports its width after layout.
let contentObserver = null
let observedContent = null
let contentWidth = 0
// The window width when the container reported its width. A resize can move
// the side bar before the container reports its new width.
let contentViewportWidth = 0
function getContentWidth() {
  const viewportWidth = getViewportWidth()
  if (!observedContent?.isConnected) {
    observedContent = document.querySelector('.app > .routerView')
    contentWidth = 0
    contentObserver ??= new ResizeObserver(([entry]) => {
      contentWidth = entry.contentRect.width
      contentViewportWidth = getViewportWidth()
    })
    contentObserver.disconnect()
    if (observedContent !== null) contentObserver.observe(observedContent)
  }
  return contentWidth > 0 && contentViewportWidth === viewportWidth
    ? Math.min(contentWidth, viewportWidth)
    : viewportWidth
}

/**
 * The most rows a list starting inside the viewport can show in it. Rows are
 * never shorter than their shells, and the list is at most as wide as the
 * pages' container, so mounting this many from the start of the list leaves no
 * visible placeholders.
 * @param {object} layout
 * @param {boolean} layout.grid
 * @param {boolean} layout.youtubeStyleShorts
 * @param {number} layout.thumbnailSize
 * @param {number} layout.columns as for getThumbnailGridStyles
 * @param {number} layout.densityScale
 */
export function getFirstScreenItemCount({ grid, youtubeStyleShorts, thumbnailSize, columns, densityScale }) {
  const width = getViewportWidth()
  const height = getViewportHeight()
  if (!(width > 0 && height > 0)) return FALLBACK_ITEM_COUNT
  const rowHeight = grid
    ? GRID_ITEM_MIN_HEIGHT + GRID_ROW_GAP * densityScale
    : LIST_ITEM_MIN_HEIGHT + LIST_ROW_GAP * densityScale
  const rowLength = grid
    ? getThumbnailGridColumnCount(thumbnailSize, getContentWidth(), width, columns, densityScale, youtubeStyleShorts)
    : 1
  return Math.ceil(height / rowHeight) * rowLength
}
