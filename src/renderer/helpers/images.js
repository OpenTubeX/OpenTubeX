/**
 * @param {{ width?: number | string, url?: string }[] | null | undefined} images
 * @returns {string}
 */
export function getBestQualityImageUrl(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return ''
  }

  let bestUrl = ''
  let bestWidth = Number.NEGATIVE_INFINITY
  let hasNumericWidth = false

  for (const image of images) {
    if (typeof image?.url !== 'string' || image.url.length === 0) {
      continue
    }

    const width = Number.parseInt(image.width)
    if (Number.isFinite(width) && (!hasNumericWidth || width > bestWidth)) {
      bestUrl = image.url
      bestWidth = width
      hasNumericWidth = true
    } else if (!hasNumericWidth && !Number.isFinite(width)) {
      bestUrl = image.url
    }
  }

  return bestUrl
}
