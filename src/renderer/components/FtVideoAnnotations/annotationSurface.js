/**
 * Return the rectangle occupied by contained video content inside its element.
 *
 * @param {number} containerWidth
 * @param {number} containerHeight
 * @param {number} videoAspectRatio
 */
export function getContainedVideoRect(containerWidth, containerHeight, videoAspectRatio) {
  if (containerWidth <= 0 || containerHeight <= 0 || !Number.isFinite(videoAspectRatio) || videoAspectRatio <= 0) {
    return null
  }

  if (containerWidth / containerHeight > videoAspectRatio) {
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
