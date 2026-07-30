export const DEFAULT_THUMBNAIL_SIZE = 100
export const MIN_THUMBNAIL_SIZE = 60
export const MAX_THUMBNAIL_SIZE = 180
export const THUMBNAIL_SIZE_STEP = 10

const DEFAULT_GRID_ITEM_SIZE = 262
const DEFAULT_SHORTS_GRID_ITEM_MIN_SIZE = 190
const GRID_GAP = 8

function getDefaultGridItemSize(gridWidth) {
  if (gridWidth <= 0) {
    return DEFAULT_GRID_ITEM_SIZE
  }

  const columnCount = Math.max(
    1,
    Math.floor((gridWidth + GRID_GAP) / (DEFAULT_GRID_ITEM_SIZE + GRID_GAP))
  )

  return (gridWidth - (columnCount - 1) * GRID_GAP) / columnCount
}

/**
 * Grid columns depend on the measured width of the grid, so these have to be
 * set on each grid element.
 * @param {number} thumbnailSize
 * @param {number} [gridWidth]
 */
export function getThumbnailGridStyles(thumbnailSize, gridWidth = 0) {
  const scale = thumbnailSize / DEFAULT_THUMBNAIL_SIZE
  const defaultGridItemSize = getDefaultGridItemSize(gridWidth)

  return {
    '--thumbnail-grid-size': `${defaultGridItemSize * scale}px`,
    '--shorts-thumbnail-grid-min-size': `${DEFAULT_SHORTS_GRID_ITEM_MIN_SIZE * scale}px`
  }
}

/**
 * List thumbnails scale off fixed values only, so these are set once on the
 * document body instead of per list.
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
