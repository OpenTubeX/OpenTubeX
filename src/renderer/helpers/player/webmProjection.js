const EBML_HEADER_ID = 0x1A45DFA3
const PROJECTION_ID = 0x7670
const VOID_ID = 0xEC
// Segment > Tracks > TrackEntry > Video
const PROJECTION_PARENT_IDS = [0x18538067, 0x1654AE6B, 0xAE, 0xE0]

/**
 * Chromium 150 rejects WebM Projection elements without the optional pose angles,
 * which YouTube's VR VP9 streams omit ("Projection element is incomplete;
 * ProjectionPoseYaw required."). The player renders VR itself, so turn each
 * Projection element into a Void element of the same length in place.
 * @param {BufferSource} data a WebM initialization segment
 * @returns {boolean} whether a Projection element was replaced
 */
export function voidWebmProjection(data) {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data)

  if (bytes.length < 4 || readUint(bytes, 0, 4) !== EBML_HEADER_ID) return false

  return voidProjections(bytes, 0, bytes.length, 0)
}

/**
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @param {number} depth index into PROJECTION_PARENT_IDS of the expected child
 */
function voidProjections(bytes, start, end, depth) {
  let replaced = false
  let offset = start

  while (offset < end) {
    const idLength = getVintLength(bytes[offset])
    const sizeOffset = offset + idLength
    if (idLength > 4 || sizeOffset >= end) break

    const id = readUint(bytes, offset, idLength)
    const sizeLength = getVintLength(bytes[sizeOffset])
    const dataOffset = sizeOffset + sizeLength
    if (sizeLength > 8 || dataOffset > end) break

    const size = readVintValue(bytes, sizeOffset, sizeLength)
    const unknownSize = isUnknownSize(bytes, sizeOffset, sizeLength)
    // Unknown sizes, and sizes past the buffer (including inexact ones above 2^53), end with the parent
    const dataEnd = unknownSize ? end : Math.min(dataOffset + size, end)

    if (depth === PROJECTION_PARENT_IDS.length && id === PROJECTION_ID && sizeLength < 8 && !unknownSize) {
      // The 2-byte ID becomes a 1-byte ID with a 1-byte longer size
      bytes[offset] = VOID_ID
      writeVint(bytes, offset + 1, sizeLength + 1, size)
      replaced = true
    } else if (id === PROJECTION_PARENT_IDS[depth]) {
      replaced = voidProjections(bytes, dataOffset, dataEnd, depth + 1) || replaced
    } else if (unknownSize) {
      break
    }

    offset = dataEnd
  }

  return replaced
}

/**
 * @param {number | undefined} firstByte
 */
function getVintLength(firstByte) {
  return firstByte ? Math.clz32(firstByte) - 23 : 9
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 */
function readUint(bytes, offset, length) {
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i]
  return value
}

/**
 * Removes the length marker before accumulating, so 8-byte sizes below 2^53 stay exact.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 */
function readVintValue(bytes, offset, length) {
  let value = bytes[offset] & (0xFF >> length)
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i]
  return value
}

/**
 * All value bits set means the size is unknown.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 */
function isUnknownSize(bytes, offset, length) {
  if ((bytes[offset] & (0xFF >> length)) !== 0xFF >> length) return false
  for (let i = 1; i < length; i++) {
    if (bytes[offset + i] !== 0xFF) return false
  }
  return true
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 * @param {number} value
 */
function writeVint(bytes, offset, length, value) {
  for (let i = length - 1; i >= 0; i--) {
    bytes[offset + i] = value % 256
    value = Math.floor(value / 256)
  }
  bytes[offset] |= 0x80 >> (length - 1)
}
