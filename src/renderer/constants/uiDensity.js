// @ts-check

/** Spacing factor of each UI Density option, applied as `--ui-density`. */
export const UI_DENSITY_SCALES = Object.freeze({ compact: 0.5, default: 1, comfortable: 1.5 })

/**
 * @param {string} density
 * @returns {number}
 */
export function getUiDensityScale(density) {
  return UI_DENSITY_SCALES[density] ?? 1
}
