export const DEFAULT_VERTICAL_TAB_HEIGHT = 30
export const MIN_VERTICAL_TAB_HEIGHT = 24
export const MAX_VERTICAL_TAB_HEIGHT = 56
export const VERTICAL_TAB_HEIGHT_STEP = 2

export function normalizeVerticalTabHeight(value) {
  const height = Number(value)

  return Number.isFinite(height)
    ? Math.max(MIN_VERTICAL_TAB_HEIGHT, Math.min(MAX_VERTICAL_TAB_HEIGHT, height))
    : DEFAULT_VERTICAL_TAB_HEIGHT
}
