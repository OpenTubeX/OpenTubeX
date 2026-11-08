export const DEFAULT_SCROLLBAR_THUMB_WIDTH = 6
export const MIN_SCROLLBAR_THUMB_WIDTH = 4
export const MAX_SCROLLBAR_THUMB_WIDTH = 20
export const SCROLLBAR_THUMB_WIDTH_STEP = 1

/**
 * Imported and synced settings can carry anything, and this one ends up in a
 * CSS length: an out of range number hides the scrollbars or makes them huge,
 * and a non-numeric one invalidates the whole sizing expression.
 *
 * @param {unknown} value
 */
export function normalizeScrollbarThumbWidth(value) {
  // Parsed rather than coerced, so an empty or missing value falls back to the
  // default instead of becoming the narrowest scrollbar.
  const width = typeof value === 'number' ? value : Number.parseFloat(value)

  return Number.isFinite(width)
    ? Math.max(MIN_SCROLLBAR_THUMB_WIDTH, Math.min(MAX_SCROLLBAR_THUMB_WIDTH, width))
    : DEFAULT_SCROLLBAR_THUMB_WIDTH
}
