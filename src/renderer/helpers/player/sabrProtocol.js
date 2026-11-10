import { UmpReader } from 'googlevideo/ump'

// Application safety budget, not a protocol maximum. A response supplies one
// requested segment; leave ample room for high-bitrate media while bounding
// retained payloads and the copy used to assemble the completed segment.
export const MAX_SABR_RESPONSE_BYTES = 128 * 1024 * 1024

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
    if (size < 0) return buffer
    if (size > MAX_SABR_RESPONSE_BYTES - dataOffset) {
      throw new Error('SABR part exceeds the response size limit')
    }
    if (!buffer.canReadBytes(dataOffset, size)) return buffer

    const { extractedBuffer, remainingBuffer } = buffer.split(dataOffset).remainingBuffer.split(size)
    onPart({ type, size, data: extractedBuffer })
    buffer = remainingBuffer
  }
  return null
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {[value: number, offset: number] | undefined}
 */
function readProtobufVarint(bytes, offset) {
  let result = 0
  let shift = 0

  while (offset < bytes.length) {
    const byte = bytes[offset++]
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) {
      return [result, offset]
    }
    shift += 7
  }

  return undefined
}

/**
 * Iterates the fields of a protobuf message without decoding their values,
 * stopping at malformed data.
 * @param {Uint8Array} bytes
 * @returns {Generator<{ field: number, wireType: number, data: Uint8Array }>}
 */
function * readProtobufFields(bytes) {
  let offset = 0

  while (offset < bytes.length) {
    const key = readProtobufVarint(bytes, offset)
    if (key === undefined) return
    offset = key[1]

    const wireType = key[0] % 8
    let start = offset
    if (wireType === 2) {
      const length = readProtobufVarint(bytes, offset)
      if (length === undefined) return
      start = length[1]
      offset = start + length[0]
    } else if (wireType === 0) {
      const value = readProtobufVarint(bytes, offset)
      if (value === undefined) return
      offset = value[1]
    } else if (wireType === 5) {
      offset += 4
    } else if (wireType === 1) {
      offset += 8
    } else {
      return
    }
    if (offset > bytes.length) return

    yield { field: Math.floor(key[0] / 8), wireType, data: bytes.subarray(start, offset) }
  }
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
  for (const { field, wireType, data } of readProtobufFields(bytes)) {
    if (field === fieldNumber && wireType === expectedWireType) return data
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

/** Asks SABR for the live head, as YouTube's player does when it joins a stream. */
export const SABR_LIVE_HEAD_TIME_MS = String(Number.MAX_SAFE_INTEGER)

const SABR_LIVE_SOURCES = new Set(['yt_live_broadcast', 'yt_premiere_broadcast'])

/**
 * Ongoing streams and premieres
 * @param {string} url
 */
export function isSabrLiveBroadcastUrl(url) {
  return SABR_LIVE_SOURCES.has(new URL(url).searchParams.get('source'))
}

/**
 * @typedef SabrLiveHead
 * @property {number} sequenceNumber newest segment the server can deliver
 * @property {number} timeMs media start time of that segment
 * @property {number} minSeekableTimeMs
 * @property {number} maxSeekableTimeMs
 * @property {number} receivedAtMs local time when the head was reported
 */

/**
 * @param {string | undefined} ticks
 * @param {number | undefined} timescale
 */
function ticksToMs(ticks, timescale) {
  const value = Number(ticks)
  return ticks && timescale > 0 && Number.isFinite(value) ? value * 1000 / timescale : undefined
}

/**
 * @param {import('googlevideo/protos').LiveMetadata} liveMetadata
 * @param {number} receivedAtMs
 * @returns {SabrLiveHead | null}
 */
export function parseSabrLiveHead(liveMetadata, receivedAtMs) {
  const sequenceNumber = Number(liveMetadata.headSequenceNumber)
  const timeMs = Number(liveMetadata.headTimeMs)
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber <= 0 || !Number.isFinite(timeMs)) return null

  return {
    sequenceNumber,
    timeMs,
    minSeekableTimeMs: ticksToMs(liveMetadata.minSeekableTimeTicks, liveMetadata.minSeekableTimescale) ?? timeMs,
    maxSeekableTimeMs: ticksToMs(liveMetadata.maxSeekableTimeTicks, liveMetadata.maxSeekableTimescale) ?? timeMs,
    receivedAtMs,
  }
}

/** @type {Map<string, Set<(head: SabrLiveHead) => void>>} */
const liveHeadListeners = new Map()

/**
 * The SABR transport sees every live head update, while the manifest parser
 * extends the timeline. Both share the player's unique scheme.
 * @param {string} scheme
 * @param {(head: SabrLiveHead) => void} listener
 * @returns {() => void} removes the listener
 */
export function onSabrLiveHead(scheme, listener) {
  let listeners = liveHeadListeners.get(scheme)
  if (!listeners) {
    listeners = new Set()
    liveHeadListeners.set(scheme, listeners)
  }
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && liveHeadListeners.get(scheme) === listeners) liveHeadListeners.delete(scheme)
  }
}

/**
 * @param {string} scheme
 * @param {SabrLiveHead} head
 */
export function publishSabrLiveHead(scheme, head) {
  for (const listener of liveHeadListeners.get(scheme) ?? []) listener(head)
}

/**
 * @param {SabrLiveHead} head
 */
export function encodeSabrLiveHead(head) {
  return new TextEncoder().encode(JSON.stringify(head))
}

/**
 * @param {ArrayBuffer | ArrayBufferView} data
 * @returns {SabrLiveHead}
 */
export function decodeSabrLiveHead(data) {
  return JSON.parse(new TextDecoder().decode(data))
}

/**
 * @param {{ target_duration_sec?: number }[]} formats
 * @returns {number | null} the segment duration of a live stream, in seconds
 */
export function getSabrLiveTargetDuration(formats) {
  const durations = formats.map(format => format.target_duration_sec).filter(duration => duration > 0)
  return durations.length > 0 ? Math.max(...durations) : null
}

/** Not in googlevideo 4's `UMPPartId` */
export const CUEPOINT_LIST_PART_ID = 69
const CUEPOINT_EVENT_STOP = 3
// YouTube's player reports this state when it throttles ad requests itself
const SSAP_STATE_RATECONTROL_CLIENT = 11
const SSAP_PLAYBACK_INFOS_FIELD = 24

/**
 * @typedef SabrCuepoint
 * @property {string} identifier
 * @property {boolean} stopped the ad break is over
 * @property {number} startTimeMs
 * @property {number} durationMs
 */

/** @param {Uint8Array} bytes */
function readProtobufDouble(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true)
}

/**
 * Reads the ad breaks of a CUEPOINT_LIST part, for which googlevideo 4 has no message.
 * @param {Uint8Array} bytes
 * @returns {SabrCuepoint[]}
 */
export function parseSabrCuepoints(bytes) {
  const cuepoints = []
  for (const info of readProtobufFields(bytes)) {
    if (info.field !== 1 || info.wireType !== 2) continue
    const cuepointBytes = extractRawProtobufField(info.data, 1)
    const timeRangeBytes = extractRawProtobufField(info.data, 4)
    if (!cuepointBytes || !timeRangeBytes) continue

    let identifier = ''
    let event = 0
    let totalDurationSec = 0
    let playheadTimeSec = 0
    for (const { field, wireType, data } of readProtobufFields(cuepointBytes)) {
      if (field === 2 && wireType === 0) event = readProtobufVarint(data, 0)[0]
      else if (field === 3 && wireType === 1) totalDurationSec = readProtobufDouble(data)
      else if (field === 4 && wireType === 1) playheadTimeSec = readProtobufDouble(data)
      else if (field === 6 && wireType === 2) identifier = new TextDecoder().decode(data)
    }

    let startTicks = 0
    let timescale = 1000
    for (const { field, wireType, data } of readProtobufFields(timeRangeBytes)) {
      if (field === 1 && wireType === 0) startTicks = readProtobufVarint(data, 0)[0]
      else if (field === 3 && wireType === 0) timescale = readProtobufVarint(data, 0)[0] || 1000
    }

    cuepoints.push({
      identifier,
      stopped: event === CUEPOINT_EVENT_STOP,
      startTimeMs: Math.floor((startTicks / timescale - playheadTimeSec) * 1000),
      durationMs: Math.round(totalDurationSec * 1000),
    })
  }
  return cuepoints
}

/**
 * @param {number[]} out
 * @param {number} value
 */
function writeProtobufVarint(out, value) {
  let remaining = BigInt.asUintN(64, BigInt(value))
  do {
    const byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    out.push(remaining > 0n ? byte | 0x80 : byte)
  } while (remaining > 0n)
}

/**
 * @param {number[]} out
 * @param {number} field
 * @param {ArrayLike<number>} bytes
 */
function writeProtobufBytes(out, field, bytes) {
  writeProtobufVarint(out, field * 8 + 2)
  writeProtobufVarint(out, bytes.length)
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i])
}

/**
 * SABR withholds the media after an ad break until the request says how the
 * client handled it. Like YouTube's player when it throttles ad requests, this
 * skips the ad. Protobuf merges repeated fields, so the bytes can be appended
 * to an encoded `VideoPlaybackAbrRequest`.
 * @param {Iterable<SabrCuepoint>} cuepoints
 * @returns {Uint8Array} its `ssapPlaybackInfos` field
 */
export function encodeSsapPlaybackInfos(cuepoints) {
  const out = []
  for (const cuepoint of cuepoints) {
    const info = []
    writeProtobufBytes(info, 7, new TextEncoder().encode(cuepoint.identifier))
    writeProtobufVarint(info, 8 * 8)
    writeProtobufVarint(info, SSAP_STATE_RATECONTROL_CLIENT)
    writeProtobufVarint(info, 10 * 8)
    writeProtobufVarint(info, cuepoint.startTimeMs)
    writeProtobufVarint(info, 11 * 8)
    writeProtobufVarint(info, cuepoint.durationMs)
    writeProtobufBytes(out, SSAP_PLAYBACK_INFOS_FIELD, info)
  }
  return Uint8Array.from(out)
}
