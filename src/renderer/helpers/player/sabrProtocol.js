/**
 * Extract a length-delimited protobuf field without decoding it.
 *
 * @param {Uint8Array} bytes
 * @param {number} fieldNumber
 * @returns {Uint8Array | undefined}
 */
export function extractRawProtobufField(bytes, fieldNumber) {
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
      if (field === fieldNumber) {
        return bytes.subarray(offset, offset + length)
      }
      offset += length
    } else if (wireType === 0) {
      if (readVarint() === undefined) return undefined
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
