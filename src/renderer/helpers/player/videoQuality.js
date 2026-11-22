/**
 * Returns the conventional resolution used to select a DASH variant.
 * Ultrawide streams are represented by the height of their 16:9 equivalent.
 *
 * @param {number | undefined} width
 * @param {number | undefined} height
 * @returns {number | null}
 */
export function getDashQualityFromDimensions(width, height) {
  if (typeof width !== 'number' || typeof height !== 'number') {
    return null
  }

  const [primary, secondary] = height > width ? [width, height] : [height, width]
  const aspectRatio = secondary / primary

  return aspectRatio > 16 / 9 ? Math.round(secondary * 9 / 16) : primary
}
