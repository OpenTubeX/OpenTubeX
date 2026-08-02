/**
 * yt-dlp only reports the stream URLs, not the byte ranges of the initialization
 * and index sections that a DASH manifest needs. Both sections sit at the very
 * start of YouTube's fragmented MP4 and WebM streams, so they can be located by
 * reading a few kilobytes of the stream itself.
 */

/** @typedef {{ start: number, end: number }} ByteRange */
/** @typedef {{ initRange: ByteRange, indexRange: ByteRange }} StreamByteRanges */

// ISO BMFF box types
const MOOV = 0x6d6f6f76
const SIDX = 0x73696478

// EBML element ids, including their length descriptor bits
const EBML_HEADER_ID = 0x1a45dfa3
const SEGMENT_ID = 0x18538067
const CUES_ID = 0x1c53bb6b
const CLUSTER_ID = 0x1f43b675

const INITIAL_PROBE_BYTES = 16 * 1024
const MAX_PROBE_BYTES = 1024 * 1024
const MAX_PROBE_ATTEMPTS = 3

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {StreamByteRanges | { requiredBytes: number } | null}
 */
function parseMp4ByteRanges(view, offset = 0) {
  let initEnd = null

  while (offset + 8 <= view.byteLength) {
    let size = view.getUint32(offset)
    const type = view.getUint32(offset + 4)
    let headerSize = 8

    if (size === 1) {
      if (offset + 16 > view.byteLength) {
        return { requiredBytes: offset + 16 }
      }

      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12)
      headerSize = 16
    }

    // a size of 0 means the box extends to the end of the file, so nothing can follow it
    if (size < headerSize) {
      return null
    }

    if (type === MOOV) {
      initEnd = offset + size - 1
    } else if (type === SIDX) {
      return initEnd === null
        ? null
        : {
            initRange: { start: 0, end: initEnd },
            indexRange: { start: offset, end: offset + size - 1 }
          }
    }

    offset += size
  }

  return { requiredBytes: offset + 8 }
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {number | null} the number of bytes the variable length integer at `offset` occupies
 */
function readVintLength(view, offset) {
  if (offset >= view.byteLength) {
    return null
  }

  const firstByte = view.getUint8(offset)

  if (firstByte === 0) {
    return null
  }

  let length = 1
  for (let mask = 0x80; (firstByte & mask) === 0; mask >>= 1) {
    length++
  }

  return length
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {{ id: number, size: number | null, dataStart: number } | null}
 */
function readEbmlElementHeader(view, offset) {
  const idLength = readVintLength(view, offset)

  if (idLength === null || idLength > 4 || offset + idLength > view.byteLength) {
    return null
  }

  let id = 0
  for (let i = 0; i < idLength; i++) {
    id = id * 256 + view.getUint8(offset + i)
  }

  const sizeOffset = offset + idLength
  const sizeLength = readVintLength(view, sizeOffset)

  if (sizeLength === null || sizeOffset + sizeLength > view.byteLength) {
    return null
  }

  let size = view.getUint8(sizeOffset) & (0xff >> sizeLength)
  // an all ones value marks an element with an unknown size
  let unknownSize = size === (0xff >> sizeLength)

  for (let i = 1; i < sizeLength; i++) {
    const byte = view.getUint8(sizeOffset + i)
    unknownSize &&= byte === 0xff
    size = size * 256 + byte
  }

  return {
    id,
    size: unknownSize ? null : size,
    dataStart: sizeOffset + sizeLength
  }
}

/**
 * @param {DataView} view
 * @returns {StreamByteRanges | { requiredBytes: number } | null}
 */
function parseWebmByteRanges(view) {
  const ebmlHeader = readEbmlElementHeader(view, 0)

  if (ebmlHeader === null) {
    return { requiredBytes: INITIAL_PROBE_BYTES }
  }

  if (ebmlHeader.id !== EBML_HEADER_ID || ebmlHeader.size === null) {
    return null
  }

  const segment = readEbmlElementHeader(view, ebmlHeader.dataStart + ebmlHeader.size)

  if (segment === null) {
    return { requiredBytes: INITIAL_PROBE_BYTES }
  }

  if (segment.id !== SEGMENT_ID) {
    return null
  }

  let offset = segment.dataStart

  // YouTube writes the cues before the first cluster, so they are always reachable
  // by walking the segment's children from the front
  while (true) {
    const element = readEbmlElementHeader(view, offset)

    if (element === null) {
      return { requiredBytes: offset + 12 }
    }

    if (element.id === CUES_ID) {
      if (element.size === null) {
        return null
      }

      return {
        initRange: { start: 0, end: offset - 1 },
        indexRange: { start: offset, end: element.dataStart + element.size - 1 }
      }
    }

    if (element.id === CLUSTER_ID || element.size === null) {
      return null
    }

    offset = element.dataStart + element.size
  }
}

/**
 * @param {ArrayBuffer} buffer the start of the stream
 * @param {boolean} isWebm
 * @returns {StreamByteRanges | { requiredBytes: number } | null} null when the stream
 * doesn't contain the sections needed for a DASH manifest
 */
export function parseStreamByteRanges(buffer, isWebm) {
  const view = new DataView(buffer)

  return isWebm ? parseWebmByteRanges(view) : parseMp4ByteRanges(view)
}

/**
 * @param {string} url
 * @param {boolean} isWebm
 * @returns {Promise<StreamByteRanges | null>}
 */
export async function probeStreamByteRanges(url, isWebm) {
  let requestedBytes = INITIAL_PROBE_BYTES

  for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt++) {
    // YouTube's own range parameter is used instead of a Range header,
    // the same way the player's request filter does it
    const response = await fetch(`${url}&range=0-${requestedBytes - 1}`)

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    const result = parseStreamByteRanges(buffer, isWebm)

    if (result === null || 'initRange' in result) {
      return result
    }

    // the whole stream is already in the buffer, so a larger request won't help
    if (buffer.byteLength < requestedBytes || result.requiredBytes > MAX_PROBE_BYTES) {
      return null
    }

    requestedBytes = Math.min(result.requiredBytes + INITIAL_PROBE_BYTES, MAX_PROBE_BYTES)
  }

  return null
}
