export const MIN_FIXED_TAB_WIDTH = 80
export const MAX_FIXED_TAB_WIDTH = 320
export const FIXED_TAB_WIDTH_STEP = 10
// The Tab Width slider's Auto position, one step below the narrowest width
export const AUTO_TAB_WIDTH_SLIDER_VALUE = MIN_FIXED_TAB_WIDTH - FIXED_TAB_WIDTH_STEP

/**
 * The width of every tab, or 0 to size tabs to their titles.
 * @param {unknown} value
 */
export function normalizeFixedTabWidth(value) {
  const width = Number(value)
  if (!Number.isFinite(width) || width <= 0) return 0

  return Math.max(MIN_FIXED_TAB_WIDTH, Math.min(MAX_FIXED_TAB_WIDTH, width))
}

/**
 * The style that applies the tab width setting to a tab bar.
 * @param {unknown} value
 */
export function fixedTabWidthStyle(value) {
  const width = normalizeFixedTabWidth(value)
  return width === 0 ? null : { '--fixed-tab-width': `${width}px` }
}
