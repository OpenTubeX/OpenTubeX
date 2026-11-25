/** Clockwise rotations of the video, in degrees */
export const VIDEO_ROTATIONS = Object.freeze([0, 90, 180, 270])

/**
 * @param {unknown} rotation
 * @returns {number}
 */
export function sanitizeVideoRotation(rotation) {
  return VIDEO_ROTATIONS.includes(/** @type {number} */ (rotation)) ? /** @type {number} */ (rotation) : 0
}

/**
 * The scale at which a video turned by a quarter fits the box it filled before.
 * @param {number} rotation
 * @param {{ width: number, height: number }} elementSize the video element's layout size
 * @param {{ width: number, height: number }} videoSize the intrinsic size, `0` before it is known
 * @returns {number}
 */
export function getVideoRotationFit(rotation, elementSize, videoSize) {
  if (rotation % 180 === 0 || elementSize.width <= 0 || elementSize.height <= 0) return 1

  // The frame as `object-fit: contain` shows it, or the whole box until the video has loaded.
  const loaded = videoSize.width > 0 && videoSize.height > 0
  const contain = loaded ? Math.min(elementSize.width / videoSize.width, elementSize.height / videoSize.height) : 1
  const frameWidth = loaded ? videoSize.width * contain : elementSize.width
  const frameHeight = loaded ? videoSize.height * contain : elementSize.height

  return Math.min(elementSize.width / frameHeight, elementSize.height / frameWidth)
}

/**
 * Maps a screen direction into the video's own coordinate system, which the
 * rotation turns and the mirroring then flips.
 * @param {{ x: number, y: number }} vector
 * @param {number} rotation
 * @param {boolean} mirrored
 * @returns {{ x: number, y: number }}
 */
export function toVideoCoordinates({ x, y }, rotation, mirrored) {
  const screenX = mirrored ? -x : x
  switch (rotation) {
    case 90: return { x: y, y: -screenX }
    case 180: return { x: -screenX, y: -y }
    case 270: return { x: -y, y: screenX }
    default: return { x: screenX, y }
  }
}
