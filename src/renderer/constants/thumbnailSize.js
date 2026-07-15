export const DEFAULT_THUMBNAIL_SIZE = 100
export const MIN_THUMBNAIL_SIZE = 60
export const MAX_THUMBNAIL_SIZE = 180
export const THUMBNAIL_SIZE_STEP = 10

const DEFAULT_GRID_ITEM_SIZE = 262
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
 * @param {number} thumbnailSize
 * @param {number} [gridWidth]
 */
export function getThumbnailSizeStyles(thumbnailSize, gridWidth = 0) {
  const scale = thumbnailSize / DEFAULT_THUMBNAIL_SIZE
  const defaultGridItemSize = getDefaultGridItemSize(gridWidth)

  return {
    '--thumbnail-grid-size': `${defaultGridItemSize * scale}px`,
    '--thumbnail-list-size': `${336 * scale}px`,
    '--thumbnail-list-max-size': `${25 * scale}vw`,
    '--thumbnail-list-mobile-max-size': `${30 * scale}vw`
  }
}
