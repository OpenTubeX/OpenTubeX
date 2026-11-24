import { getThumbnailGridColumnCount } from '../constants/thumbnailSize'

// The minimum block sizes of the row shells in FtListLazyWrapper.css.
const GRID_ITEM_MIN_HEIGHT = 264
const LIST_ITEM_MIN_HEIGHT = 131
// The row gaps of FtAutoGrid.css at the Default UI Density.
const GRID_ROW_GAP = 8
const LIST_ROW_GAP = 4
// Used before the window has a size.
const FALLBACK_ITEM_COUNT = 16

// Android WebView lays out the page to answer innerWidth and innerHeight, which
// a list mounting with a new page would force mid-render. Keep the size that
// the last resize reported instead.
let viewportWidth = 0
let viewportHeight = 0
function readViewportSize() {
  viewportWidth = window.innerWidth
  viewportHeight = window.innerHeight
}
if (typeof window !== 'undefined') {
  readViewportSize()
  window.addEventListener('resize', readViewportSize)
}

/**
 * The most rows a list starting inside the viewport can show in it. Rows are
 * never shorter than their shells, so mounting this many from the start of
 * the list leaves no visible placeholders.
 * @param {object} layout
 * @param {boolean} layout.grid
 * @param {boolean} layout.youtubeStyleShorts
 * @param {number} layout.thumbnailSize
 * @param {number} layout.columns as for getThumbnailGridStyles
 * @param {number} layout.densityScale
 * @param {{ width: number, height: number }} [viewport]
 */
export function getFirstScreenItemCount({ grid, youtubeStyleShorts, thumbnailSize, columns, densityScale }, viewport = { width: viewportWidth, height: viewportHeight }) {
  const { width, height } = viewport
  if (!(width > 0 && height > 0)) return FALLBACK_ITEM_COUNT
  const rowHeight = grid
    ? GRID_ITEM_MIN_HEIGHT + GRID_ROW_GAP * densityScale
    : LIST_ITEM_MIN_HEIGHT + LIST_ROW_GAP * densityScale
  // The grid is at most as wide as the viewport.
  const rowLength = grid
    ? getThumbnailGridColumnCount(thumbnailSize, width, width, columns, densityScale, youtubeStyleShorts)
    : 1
  return Math.ceil(height / rowHeight) * rowLength
}
