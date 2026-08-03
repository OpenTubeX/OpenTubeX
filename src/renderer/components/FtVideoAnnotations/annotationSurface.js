/**
 * Return the rectangle occupied by fitted video content inside its element.
 *
 * @param {number} containerWidth
 * @param {number} containerHeight
 * @param {number} videoAspectRatio
 * @param {'contain' | 'cover'} [fit]
 */
export function getVideoRect(containerWidth, containerHeight, videoAspectRatio, fit = 'contain') {
  if (containerWidth <= 0 || containerHeight <= 0 || !Number.isFinite(videoAspectRatio) || videoAspectRatio <= 0) {
    return null
  }

  const containerAspectRatio = containerWidth / containerHeight
  const fitToHeight = fit === 'cover'
    ? containerAspectRatio < videoAspectRatio
    : containerAspectRatio > videoAspectRatio

  if (fitToHeight) {
    const width = containerHeight * videoAspectRatio

    return {
      left: (containerWidth - width) / 2,
      top: 0,
      width,
      height: containerHeight
    }
  }

  const height = containerWidth / videoAspectRatio

  return {
    left: 0,
    top: (containerHeight - height) / 2,
    width: containerWidth,
    height
  }
}
