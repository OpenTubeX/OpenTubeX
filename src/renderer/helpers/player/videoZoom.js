/**
 * Preset levels keep a useful amount of the frame visible. A gesture can reach
 * farther when a narrow video needs more zoom to fill the display.
 */
export const VIDEO_ZOOM_LEVELS = Object.freeze([1, 1.25, 1.5, 1.75, 2, 2.5, 3])

export const DEFAULT_VIDEO_ZOOM = VIDEO_ZOOM_LEVELS[0]
export const MAX_VIDEO_GESTURE_ZOOM = 8

/**
 * Keeps continuous gesture values within the supported visual crop range.
 * @param {unknown} zoom
 * @returns {number}
 */
export function sanitizeVideoZoom(zoom) {
  const value = Number(zoom)

  if (!Number.isFinite(value)) {
    return DEFAULT_VIDEO_ZOOM
  }

  return Math.min(MAX_VIDEO_GESTURE_ZOOM, Math.max(DEFAULT_VIDEO_ZOOM, value))
}

/**
 * @param {unknown} zoom the current zoom level
 * @param {number} direction `1` to zoom in, `-1` to zoom out
 * @returns {number} the neighbouring level, or the current one at either end
 */
export function stepVideoZoom(zoom, direction) {
  const value = sanitizeVideoZoom(zoom)

  if (direction > 0) {
    if (value >= VIDEO_ZOOM_LEVELS.at(-1)) return value
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
 * The scale at which a contained video fills its visible player area.
 * @param {{ width: number, height: number }} playerSize
 * @param {{ width: number, height: number }} elementSize
 * @param {{ width: number, height: number }} videoSize
 * @returns {number | null}
 */
export function getVideoFillZoom(playerSize, elementSize, videoSize) {
  if ([playerSize.width, playerSize.height, elementSize.width, elementSize.height, videoSize.width, videoSize.height]
    .some(value => !Number.isFinite(value) || value <= 0)) return null

  const fit = Math.min(elementSize.width / videoSize.width, elementSize.height / videoSize.height)
  const fillZoom = Math.max(
    playerSize.width / (videoSize.width * fit),
    playerSize.height / (videoSize.height * fit),
  )
  return fillZoom > DEFAULT_VIDEO_ZOOM && fillZoom <= MAX_VIDEO_GESTURE_ZOOM ? fillZoom : null
}

/**
 * Edge feedback starts before the narrower band that snaps on release.
 * @param {number} zoom
 * @param {number | null} fillZoom
 * @returns {{ proximity: number, snap: boolean }}
 */
export function getVideoFillZoomProximity(zoom, fillZoom) {
  if (fillZoom === null) return { proximity: 0, snap: false }
  const distance = Math.abs(zoom - fillZoom)
  return {
    proximity: Math.max(0, 1 - distance / 0.1),
    snap: distance <= 0.08,
  }
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
  maximumZoom = VIDEO_ZOOM_LEVELS.at(-1),
}) {
  const minimumZoom = VIDEO_ZOOM_LEVELS[0]
  const zoom = Math.min(Math.max(maximumZoom, startZoom), Math.max(minimumZoom, startZoom * scale))

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
