import { AdState, CuepointList } from 'googlevideo/protos'
import { UmpReader } from 'googlevideo/ump'

// Application safety budget, not a protocol maximum. A response supplies one
// requested segment; leave ample room for high-bitrate media while bounding
// retained payloads and the copy used to assemble the completed segment.
export const MAX_SABR_RESPONSE_BYTES = 128 * 1024 * 1024

/**
 * @param {Pick<import('googlevideo/ump').UmpReaderCallbacks, 'onPart'>} callbacks
 */
export function createSabrUmpReader({ onPart }) {
  return new UmpReader({
    onPart,
    // Rejects an oversized part once its payload starts, instead of buffering
    // it; returning false keeps UmpReader waiting for the complete part.
    onPartialPart(_type, _chunk, _offset, totalSize) {
      if (totalSize > MAX_SABR_RESPONSE_BYTES) {
        throw new Error('SABR part exceeds the response size limit')
      }
      return false
    },
  })
}

/**
 * Reads the UMP varint that starts MEDIA and MEDIA_END parts. Header IDs can
 * exceed one byte, so the first byte alone is not the ID.
 * @param {import('googlevideo/ump').CompositeBuffer} buffer
 * @returns {[value: number, offset: number]}
 */
export function readUmpVarInt(buffer) {
  const first = buffer.getUint8(0)
  const length = first < 0x80 ? 1 : first < 0xc0 ? 2 : first < 0xe0 ? 3 : first < 0xf0 ? 4 : 5
  let value = length === 5 ? 0 : first & (0xff >> length)
  let shift = length === 5 ? 0 : 8 - length
  for (let offset = 1; offset < length; offset++) {
    value += buffer.getUint8(offset) * 2 ** shift
    shift += 8
  }
  return [value, length]
}

/**
 * @param {string} formatId
 */
export function parseSabrFormatId(formatId) {
  // xtags can contain hyphens, so only the first two separators are structural.
  const firstSeparator = formatId.indexOf('-')
  const secondSeparator = formatId.indexOf('-', firstSeparator + 1)

  const xtags = formatId.slice(secondSeparator + 1)
  return {
    itag: parseInt(formatId.slice(0, firstSeparator)),
    lastModified: formatId.slice(firstSeparator + 1, secondSeparator),
    // googlevideo leaves absent fields undefined, also in received headers
    xtags: xtags === '' ? undefined : xtags
  }
}

/**
 * googlevideo leaves fields the server omits undefined, which in proto3 means
 * zero. Live media headers omit the zero lastModified, for example.
 * @param {import('googlevideo/protos').FormatId | undefined} received
 * @param {import('googlevideo/protos').FormatId} requested
 */
export function isSameSabrFormat(received, requested) {
  return received?.itag === requested.itag &&
    (received.lastModified ?? '0') === (requested.lastModified ?? '0') &&
    (received.xtags ?? '') === (requested.xtags ?? '')
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
 * @param {import('googlevideo/protos').SabrLiveMetadata} liveMetadata
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

/**
 * @typedef SabrLiveSegment
 * @property {number} windowSequenceNumber the live window's segment that was requested
 * @property {number} windowGeneration how often the live window had re-timed its segments when it was requested
 * @property {number} sequenceNumber the segment SABR delivered for it
 * @property {number} startMs media start time SABR reported for it
 */

/**
 * The SABR transport sees every live head and delivered segment, while the
 * manifest parser keeps the timeline. Both share the player's unique scheme.
 * @template T
 */
class SabrLiveEvents {
  constructor() {
    /** @type {Map<string, Set<(value: T) => void>>} */
    this.listeners = new Map()
  }

  /**
   * @param {string} scheme
   * @param {(value: T) => void} listener
   * @returns {() => void} removes the listener
   */
  on(scheme, listener) {
    let listeners = this.listeners.get(scheme)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(scheme, listeners)
    }
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && this.listeners.get(scheme) === listeners) this.listeners.delete(scheme)
    }
  }

  /**
   * @param {string} scheme
   * @param {T} value
   */
  publish(scheme, value) {
    for (const listener of this.listeners.get(scheme) ?? []) listener(value)
  }
}

/** @type {SabrLiveEvents<SabrLiveHead>} */
const liveHeads = new SabrLiveEvents()
/** @type {SabrLiveEvents<SabrLiveSegment>} */
const liveSegments = new SabrLiveEvents()

/**
 * @param {string} scheme
 * @param {(head: SabrLiveHead) => void} listener
 * @returns {() => void} removes the listener
 */
export function onSabrLiveHead(scheme, listener) {
  return liveHeads.on(scheme, listener)
}

/**
 * @param {string} scheme
 * @param {SabrLiveHead} head
 */
export function publishSabrLiveHead(scheme, head) {
  liveHeads.publish(scheme, head)
}

/**
 * @param {string} scheme
 * @param {(segment: SabrLiveSegment) => void} listener
 * @returns {() => void} removes the listener
 */
export function onSabrLiveSegment(scheme, listener) {
  return liveSegments.on(scheme, listener)
}

/**
 * Reports a delivered live audio or video segment, which the live window
 * compares with its estimate before the player asks for the next one.
 * @param {string} scheme
 * @param {SabrLiveSegment} segment
 */
export function publishSabrLiveSegment(scheme, segment) {
  liveSegments.publish(scheme, segment)
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

/**
 * @typedef SabrCuepoint
 * @property {string} identifier
 * @property {number} startTimeMs
 * @property {number} durationMs
 */

/**
 * Reads the ad breaks of a CUEPOINT_LIST part.
 * @param {Uint8Array} bytes
 * @returns {SabrCuepoint[]}
 */
export function parseSabrCuepoints(bytes) {
  const cuepoints = []
  for (const { cuepoint, timeRange } of CuepointList.decode(bytes).ssapInfos) {
    if (!cuepoint || !timeRange) continue

    const timescale = timeRange.timescale || 1000
    cuepoints.push({
      identifier: cuepoint.identifier ?? '',
      startTimeMs: Math.floor((Number(timeRange.startTicks ?? 0) / timescale - (cuepoint.playheadTimeSec ?? 0)) * 1000),
      durationMs: Math.round((cuepoint.totalDurationSec ?? 0) * 1000),
    })
  }
  return cuepoints
}

/**
 * SABR withholds the media after an ad break until the request says how the
 * client handled it. Like YouTube's player when it throttles ad requests, this
 * skips the ad.
 * @param {Iterable<SabrCuepoint>} cuepoints
 * @returns {import('googlevideo/protos').SsapPlaybackInfo[]}
 */
export function createSsapPlaybackInfos(cuepoints) {
  return Array.from(cuepoints, cuepoint => ({
    adCpns: [],
    cuepointId: cuepoint.identifier,
    state: AdState.RATECONTROL_CLIENT,
    startTimeMs: String(cuepoint.startTimeMs),
    durationMs: String(cuepoint.durationMs),
  }))
}
