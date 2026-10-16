export const DEFAULT_THUMBNAIL_SIZE = 100
export const MIN_THUMBNAIL_SIZE = 60
export const MAX_THUMBNAIL_SIZE = 180
export const THUMBNAIL_SIZE_STEP = 10
export const PHONE_THUMBNAIL_MAX_SIZE = DEFAULT_THUMBNAIL_SIZE
export const PHONE_THUMBNAIL_VIEWPORT_WIDTH = 680

const DEFAULT_GRID_ITEM_SIZE = 262
const DEFAULT_SHORTS_GRID_ITEM_MIN_SIZE = 190
const GRID_GAP = 8

function getDefaultGridColumnCount(gridWidth, viewportWidth) {
  // Start with two columns on phones, then scale the resulting card width
  // directly so every thumbnail slider step visibly changes its size.
  return Math.max(
    viewportWidth <= PHONE_THUMBNAIL_VIEWPORT_WIDTH ? 2 : 1,
    Math.floor((gridWidth + GRID_GAP) / (DEFAULT_GRID_ITEM_SIZE + GRID_GAP))
  )
}

/**
 * Grid columns depend on the measured width of the grid, so these have to be
 * set on each grid element.
 *
 * `--thumbnail-grid-stretch` expresses the same card size relative to the
 * grid's rendered width. A window resize lays the grid out once before it can
 * be measured again; growing the cards with the grid in that layout keeps it
 * from becoming shorter and clamping the page's scroll position.
 * @param {number} thumbnailSize
 * @param {number} [gridWidth] the stable measured width
 * @param {number} [viewportWidth]
 * @param {number} [renderedWidth] the grid's current content width
 * @param {boolean} [fullWidth] Show one card per row. Shorts keep their sized
 * grid in wider windows, where a full-width portrait card would not fit.
 */
export function getThumbnailGridStyles(thumbnailSize, gridWidth = 0, viewportWidth = gridWidth, renderedWidth = gridWidth, fullWidth = false) {
  // Larger cards cannot fit two per row on a phone, so a size saved in a wider
  // window shows at the phone slider's endpoint.
  const phone = gridWidth > 0 && viewportWidth <= PHONE_THUMBNAIL_VIEWPORT_WIDTH
  const scale = (phone ? Math.min(thumbnailSize, PHONE_THUMBNAIL_MAX_SIZE) : thumbnailSize) / DEFAULT_THUMBNAIL_SIZE
  const widthAdjustment = renderedWidth - gridWidth
  let size = DEFAULT_GRID_ITEM_SIZE * scale
  let stretch = '0px'

  if (fullWidth && gridWidth > 0) {
    size = gridWidth
    stretch = `calc(100% - ${widthAdjustment}px)`
  } else if (gridWidth > 0) {
    const columnCount = getDefaultGridColumnCount(gridWidth, viewportWidth)
    const gaps = (columnCount - 1) * GRID_GAP
    size = (gridWidth - gaps) / columnCount * scale
    stretch = `calc((100% - ${widthAdjustment + gaps}px) * ${scale / columnCount})`
  }

  return {
    '--thumbnail-grid-size': `${size}px`,
    '--thumbnail-grid-stretch': stretch,
    '--shorts-thumbnail-grid-min-size': `${DEFAULT_SHORTS_GRID_ITEM_MIN_SIZE * scale}px`
  }
}

/**
 * List thumbnails scale off fixed values only. Set these on the document body
 * for general lists or on a playlist page for its independent preference.
 * @param {number} thumbnailSize
 */
export function getThumbnailListStyles(thumbnailSize) {
  const scale = thumbnailSize / DEFAULT_THUMBNAIL_SIZE

  return {
    '--thumbnail-list-size': `${336 * scale}px`,
    '--thumbnail-list-max-size': `${25 * scale}vw`,
    '--thumbnail-list-mobile-max-size': `${30 * scale}vw`
  }
}
