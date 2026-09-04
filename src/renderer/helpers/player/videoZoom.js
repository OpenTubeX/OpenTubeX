/**
 * Zoom is a purely visual crop of the video surface, so the levels are the ones
 * that still leave a useful amount of the frame visible.
 */
export const VIDEO_ZOOM_LEVELS = Object.freeze([1, 1.25, 1.5, 1.75, 2, 2.5, 3])

export const DEFAULT_VIDEO_ZOOM = VIDEO_ZOOM_LEVELS[0]

/**
 * Keeps continuous gesture values within the range offered by the preset
 * controls.
 * @param {unknown} zoom
 * @returns {number}
 */
export function sanitizeVideoZoom(zoom) {
  const value = Number(zoom)

  if (!Number.isFinite(value)) {
    return DEFAULT_VIDEO_ZOOM
  }

  return Math.min(VIDEO_ZOOM_LEVELS.at(-1), Math.max(DEFAULT_VIDEO_ZOOM, value))
}

/**
 * @param {unknown} zoom the current zoom level
 * @param {number} direction `1` to zoom in, `-1` to zoom out
 * @returns {number} the neighbouring level, or the current one at either end
 */
export function stepVideoZoom(zoom, direction) {
  const value = sanitizeVideoZoom(zoom)

  if (direction > 0) {
    return VIDEO_ZOOM_LEVELS.find(level => level > value) ?? VIDEO_ZOOM_LEVELS.at(-1)
  }

  if (direction < 0) {
    for (let index = VIDEO_ZOOM_LEVELS.length - 1; index >= 0; index--) {
      if (VIDEO_ZOOM_LEVELS[index] < value) return VIDEO_ZOOM_LEVELS[index]
    }
  }

  return direction === 0 ? value : DEFAULT_VIDEO_ZOOM
}

/**
 * @param {number} zoom
 * @returns {string}
 */
export function formatVideoZoom(zoom) {
  return `${Math.round(sanitizeVideoZoom(zoom) * 100)}%`
}

/**
 * Resolves a two-finger zoom while keeping the content beneath the gesture's
 * focal point stationary. Focal coordinates are relative to the video centre.
 */
export function resolveVideoZoomPinch({
  startZoom,
  startOffset,
  startFocal,
  focal,
  scale,
  size,
}) {
  const minimumZoom = VIDEO_ZOOM_LEVELS[0]
  const maximumZoom = VIDEO_ZOOM_LEVELS.at(-1)
  const zoom = Math.min(maximumZoom, Math.max(minimumZoom, startZoom * scale))

  const resolveAxis = (dimension, startOffsetValue, startFocalValue, focalValue) => {
    const startMaximumTranslation = dimension * (startZoom - 1) / 2
    const startTranslation = startOffsetValue * startMaximumTranslation
    const contentCoordinate = (startFocalValue - startTranslation) / startZoom
    const translation = focalValue - zoom * contentCoordinate
    const maximumTranslation = dimension * (zoom - 1) / 2
    if (maximumTranslation <= 0) return 0
    return Math.min(1, Math.max(-1, translation / maximumTranslation))
  }

  return {
    zoom,
    offset: {
      x: resolveAxis(size.width, startOffset.x, startFocal.x, focal.x),
      y: resolveAxis(size.height, startOffset.y, startFocal.y, focal.y),
    },
  }
}
