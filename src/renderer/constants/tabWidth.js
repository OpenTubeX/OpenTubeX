export const DEFAULT_FIXED_TAB_WIDTH = 180
export const MIN_FIXED_TAB_WIDTH = 80
export const MAX_FIXED_TAB_WIDTH = 320
export const FIXED_TAB_WIDTH_STEP = 10

export function normalizeFixedTabWidth(value) {
  const width = Number(value)

  return Number.isFinite(width)
    ? Math.max(MIN_FIXED_TAB_WIDTH, Math.min(MAX_FIXED_TAB_WIDTH, width))
    : DEFAULT_FIXED_TAB_WIDTH
}
