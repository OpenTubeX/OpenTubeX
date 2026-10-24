import { UmpReader } from 'googlevideo/ump'

/**
 * Consume complete UMP parts, retaining even a partial type/size header for
 * the next network chunk. UmpReader.read() only returns a remainder once a
 * complete header and at least one payload byte have arrived.
 * @param {import('googlevideo/ump').CompositeBuffer} buffer
 * @param {(part: import('googlevideo/shared-types').Part) => void} onPart
 * @returns {import('googlevideo/ump').CompositeBuffer | null}
 */
export function readCompleteUmpParts(buffer, onPart) {
  while (buffer.getLength() > 0) {
    const reader = new UmpReader(buffer)
    const [type, sizeOffset] = reader.readVarInt(0)
    if (type < 0) return buffer
    const [size, dataOffset] = reader.readVarInt(sizeOffset)
    if (size < 0 || !buffer.canReadBytes(dataOffset, size)) return buffer

    const { extractedBuffer, remainingBuffer } = buffer.split(dataOffset).remainingBuffer.split(size)
    onPart({ type, size, data: extractedBuffer })
    buffer = remainingBuffer
  }
  return null
}

/**
 * Extract a protobuf field without decoding it.
 *
 * @param {Uint8Array} bytes
 * @param {number} fieldNumber
 * @param {number} expectedWireType
 * @returns {Uint8Array | undefined}
 */
export function extractRawProtobufField(bytes, fieldNumber, expectedWireType = 2) {
  let offset = 0

  function readVarint() {
    let result = 0
    let shift = 0

    while (offset < bytes.length) {
      const byte = bytes[offset++]
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) {
        return result
      }
      shift += 7
    }

    return undefined
  }

  while (offset < bytes.length) {
    const key = readVarint()
    if (key === undefined) return undefined

    const wireType = key % 8
    const field = Math.floor(key / 8)

    if (wireType === 2) {
      const length = readVarint()
      if (length === undefined || offset + length > bytes.length) return undefined
      if (field === fieldNumber && expectedWireType === 2) {
        return bytes.subarray(offset, offset + length)
      }
      offset += length
    } else if (wireType === 0) {
      const valueStart = offset
      if (readVarint() === undefined) return undefined
      if (field === fieldNumber && expectedWireType === 0) {
        return bytes.subarray(valueStart, offset)
      }
    } else if (wireType === 5) {
      offset += 4
    } else if (wireType === 1) {
      offset += 8
    } else {
      return undefined
    }
  }

  return undefined
}

/**
 * @param {string} formatId
 */
export function parseSabrFormatId(formatId) {
  // xtags can contain hyphens, so only the first two separators are structural.
  const firstSeparator = formatId.indexOf('-')
  const secondSeparator = formatId.indexOf('-', firstSeparator + 1)

  return {
    itag: parseInt(formatId.slice(0, firstSeparator)),
    lastModified: formatId.slice(firstSeparator + 1, secondSeparator),
    xtags: formatId.slice(secondSeparator + 1)
  }
}

/**
 * @param {string} uri
 * @param {object} request
 */
export function createAbandonedSabrResponse(uri, request) {
  return {
    uri,
    originalUri: uri,
    data: new ArrayBuffer(0),
    headers: {},
    status: 200,
    fromCache: false,
    originalRequest: request,
    timeMs: 0,
  }
}
