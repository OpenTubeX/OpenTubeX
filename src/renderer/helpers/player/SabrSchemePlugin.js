import { base64ToU8, concatenateChunks, EventEmitterLike, MAX_INT32_VALUE } from 'googlevideo/utils'
import {
  UMPPartId,
  VideoPlaybackAbrRequest,
  StreamProtectionStatus,
  SabrError,
  SabrRedirect,
  MediaHeader,
  SabrContextSendingPolicy,
  SabrContextUpdate,
  SabrContextWritePolicy,
  NextRequestPolicy,
  ReloadPlaybackContext,
  SabrLiveMetadata,
} from 'googlevideo/protos'
import shaka from 'shaka-player'

import {
  createAbandonedSabrResponse,
  createSabrUmpReader,
  createSsapPlaybackInfos,
  encodeSabrLiveHead,
  isSameSabrFormat,
  MAX_SABR_RESPONSE_BYTES,
  parseSabrCuepoints,
  parseSabrFormatId,
  parseSabrLiveHead,
  publishSabrLiveHead,
  publishSabrLiveSegment,
  readUmpVarInt,
  SABR_LIVE_HEAD_TIME_MS
} from './sabrProtocol'
import { fetchGoogleVideo } from './googleVideoFallback'
import { disableDirectPlayer } from '../api/direct-player.js'

const AbortableOperation = shaka.util.AbortableOperation
const ShakaError = shaka.util.Error

/**
 * @typedef OperationInputs
 * @type {object}
 * @property {string} uri
 * @property {shaka.extern.Request} request
 * @property {shaka.net.NetworkingEngine.RequestType} requestType
 * @property {shaka.extern.HeadersReceived} headersReceived
 * The following are calculated from above properties
 * @property {string} formatIdString
 * @property {boolean} isInit
 * @property {boolean} isLiveHead - only asks for the live head, without media
 * @property {number} sequenceNumber - a live lookup accepts any segment instead
 * @property {boolean} isLiveLookup - asks for the live segment that contains the requested time
 * @property {number} liveWindowSequenceNumber - the live window's estimate of the sequence number
 * @property {number} liveWindowGeneration - how often the live window had re-timed its segments
 * @property {number | undefined} targetDurationMs - only live segments have one
 * @property {string} streamKind
 */
/**
 * @typedef AbortStatus
 * @type {object}
 * @property {boolean} cancelled
 * @property {boolean} timedOut
 * @property {boolean} playerReloadRequested
 * @property {boolean} finished
 */
/**
 * @typedef CurrentState
 * @type {object}
 * @property {Map<string, Uint8Array>} initDataCache
 * @property {VideoPlaybackAbrRequest} abrRequest
 * @property {RequestInit & {body: Uint8Array}} requestInit
 * @property {AbortStatus} abortStatus
 * @property {AbortController} abortController
 * @property {SabrStreamState} sabrStreamState
 * @property {?TimeoutController} timeoutController
 * @property {?EventEmitterLike} eventEmitter
 * @property {number} cumulativeBackOffTimeMs
 * @property {number} cumulativeBackOffRequested
 * @property {number} cumulativeRetries
 * @property {number} startedAtMs
 * @property {(() => number) | undefined} getBufferedAheadSeconds
 * @property {(() => number) | undefined} getPlaybackRate
 * @property {string} scheme
 * @property {{ afterMs: number, beforeMs: number }} liveTimeBounds - the requested live segment lies between these times
 */
/**
 * @typedef SabrStreamState
 * @type {object}
 * @property {string} sabrUrl
 * @property {Set<number>} activeSabrContextTypes
 * @property {Map<number, SabrContextUpdate>} sabrContexts
 * @property {number} backoffUntilMs
 * @property {Uint8Array | undefined} playbackCookieBytes
 * @property {boolean} playerReloadRequested
 * @property {number} requestNumber
 * @property {Set<string>} deliveredMediaFor
 * @property {boolean} attestationPending
 * @property {boolean} mediaWithheld
 * @property {Map<string, import('./sabrProtocol').SabrCuepoint>} cuepoints recent ad breaks, oldest first
 * @property {Map<number, number>} deliveredLiveStartsMs reported start of recently delivered live segments, by sequence number
 * @property {Map<string, DeliveredLiveSegment>} lastLiveSegments the last live segment delivered for each stream kind
 */
/**
 * @typedef DeliveredLiveSegment
 * @type {object}
 * @property {number} liveWindowSequenceNumber the segment the live window asked for
 * @property {number} liveWindowGeneration how often the live window had re-timed its segments then
 * @property {number} sequenceNumber the segment SABR delivered for it
 * @property {number} startMs
 */
/**
 * @typedef TimeoutController
 * @type {object}
 * @property {() => void} resetTimeoutOnce
 * @property {() => void} clearTimeout
 */
/**
 * @typedef SabrStream
 * @type {object}
 * @property {(cb: ({backoffMs: number}) => void) => void} onBackoffRequested
 * @property {(cb: (reloadPlaybackContext?: ReloadPlaybackContext) => void) => void} onReloadOnce
 * @property {() => string} getUrl the server URL after SABR redirects
 * @property {() => void | undefined} cleanup
 */

const BACKOFF_WITHOUT_MEDIA_BUDGET_MS = 20_000
const BACKOFF_ROUNDS_WITHOUT_MEDIA = 6
/** Leaves time for a reload before playback runs out of withheld media. */
const WITHHELD_MEDIA_RELOAD_BUFFER_SECONDS = 10
const WITHHELD_MEDIA_POLL_MS = 1000
/** Playback waits on a backoff once less than this is buffered. */
const BACKOFF_STALL_BUFFER_MS = 500
/** Checks the buffer at most this often while playback outlasts a backoff. */
const BACKOFF_BUFFER_POLL_MS = 250
/**
 * SABR answers a live segment that is not out yet with a policy to retry
 * without a backoff. Ask again at this pace instead of flooding the server.
 */
const LIVE_SEGMENT_POLL_MS = 500
/**
 * Ad breaks are minutes apart, so this keeps the ones around the playhead.
 * SABR sends an evicted break's cue point again when playback returns to it.
 */
const MAX_REPORTED_CUEPOINTS = 8
/** More than a live buffer holds, even with one-second segments */
const MAX_DELIVERED_LIVE_SEGMENTS = 512
const LIVE_START_TOLERANCE_SECONDS = 0.1
/** Audio, video and captions; SABR sends no captions without both of the others */
const ENABLED_TRACK_TYPES_WITH_CAPTIONS = 7

/**
 * @param {shaka.media.SegmentReference} reference
 */
function getSequenceNumber(reference) {
  return parseInt(new URL(reference.getUris()[0]).searchParams.get('sq'))
}

/**
 * Live media starts near, not exactly at, its estimated segment times, so a
 * segment counts as buffered when its middle is. A segment shorter than the
 * target duration shifts the media after it by up to a segment from the
 * estimates, so delivered segments count by the start SABR reported instead.
 * @param {shaka.extern.BufferedRange} buffered
 * @param {shaka.media.SegmentIndex} segmentIndex
 * @param {Map<number, number>} deliveredStartsMs
 */
function getBufferedLiveSegments(buffered, segmentIndex, deliveredStartsMs) {
  if (deliveredStartsMs.size > 0) {
    let startSegmentIndex = Infinity
    let endSegmentIndex = -Infinity
    for (const [sequenceNumber, startMs] of deliveredStartsMs) {
      // Buffered media starts within milliseconds of the reported start
      const start = startMs / 1000 + LIVE_START_TOLERANCE_SECONDS
      if (start >= buffered.start && start < buffered.end) {
        startSegmentIndex = Math.min(startSegmentIndex, sequenceNumber)
        endSegmentIndex = Math.max(endSegmentIndex, sequenceNumber)
      }
    }
    return { startSegmentIndex, endSegmentIndex }
  }

  const middle = reference => (reference.startTime + reference.endTime) / 2

  const firstPosition = segmentIndex.find(buffered.start) ?? segmentIndex.getNumEvicted()
  let first = segmentIndex.get(firstPosition)
  if (first && middle(first) < buffered.start) first = segmentIndex.get(firstPosition + 1) ?? first

  const lastPosition = segmentIndex.find(buffered.end) ?? segmentIndex.getNumEvicted() + segmentIndex.getNumReferences() - 1
  let last = segmentIndex.get(lastPosition)
  if (last && middle(last) > buffered.end) last = segmentIndex.get(lastPosition - 1) ?? last

  return {
    startSegmentIndex: first ? getSequenceNumber(first) : 0,
    endSegmentIndex: last ? getSequenceNumber(last) : 0,
  }
}

/**
 * @param {import('googlevideo/protos').FormatId} formatId
 * @param {shaka.extern.BufferedRange} buffered
 * @param {shaka.media.SegmentIndex} segmentIndex
 * @param {boolean} isLive
 * @param {Map<number, number>} deliveredLiveStartsMs
 * @returns {import('googlevideo/protos').BufferedRange | null}
 */
function createBufferedRange(formatId, buffered, segmentIndex, isLive, deliveredLiveStartsMs) {
  let startSegmentIndex
  let endSegmentIndex

  if (isLive) {
    // Live sequence numbers are not positions in the moving window
    ({ startSegmentIndex, endSegmentIndex } = getBufferedLiveSegments(buffered, segmentIndex, deliveredLiveStartsMs))
    // Less than half a segment is buffered
    if (startSegmentIndex > endSegmentIndex) return null
  } else {
    startSegmentIndex = segmentIndex.find(buffered.start) ?? 0
    endSegmentIndex = segmentIndex.find(buffered.end)
    if (endSegmentIndex == null) {
      // Using Last end time will get `null` in `segmentIndex.find`
      endSegmentIndex = segmentIndex.getNumReferences() - 1
    }
  }

  return {
    formatId,
    startTimeMs: String(Math.round(buffered.start * 1000)),
    durationMs: String(Math.round((buffered.end - buffered.start) * 1000)),
    startSegmentIndex,
    endSegmentIndex: endSegmentIndex,
  }
}

/**
 * Creates a bogus buffered range for a format. Used when we want to signal to the server to not send any
 * segments for this format.
 * @param {import('googlevideo/protos').FormatId} formatId - The format to create a full buffer range for.
 * @returns {import('googlevideo/protos').BufferedRange} A BufferedRange object indicating the entire format is buffered.
 */
function createFullBufferRange(formatId) {
  return {
    formatId: formatId,
    durationMs: MAX_INT32_VALUE,
    startTimeMs: '0',
    startSegmentIndex: parseInt(MAX_INT32_VALUE),
    endSegmentIndex: parseInt(MAX_INT32_VALUE),
    timeRange: {
      durationTicks: MAX_INT32_VALUE,
      startTicks: '0',
      timescale: 1000
    }
  }
}

/**
 * @param {shaka.Player} player
 * @param {shaka.extern.Manifest} manifest
 * @param {boolean} audioFormatsActive
 * @param {boolean} streamIsVideo - Fake audio bufferRange can be used
 * @param {boolean} streamIsAudio - Fake video bufferRange can be used
 * @param {import('googlevideo/protos').BufferedRange[]} bufferedRanges
 * @param {shaka.extern.Track} activeVariant
 * @param {Map<number, number>} deliveredLiveStartsMs
 */
function fillBufferedRanges(player, manifest, audioFormatsActive, streamIsVideo, streamIsAudio, bufferedRanges, activeVariant, deliveredLiveStartsMs) {
  const bufferedInfo = player.getBufferedInfo()
  const isLive = manifest.presentationTimeline.isLive()

  if (bufferedInfo.audio.length > 0 || bufferedInfo.video.length > 0) {
    let activeManifestVariant
    if (audioFormatsActive) {
      activeManifestVariant = manifest.variants.find((variant) => {
        return variant.audio.originalId === activeVariant.originalAudioId
      })
    } else {
      activeManifestVariant = manifest.variants.find((variant) => {
        return variant.audio.originalId === activeVariant.originalAudioId &&
          variant.video.originalId === activeVariant.originalVideoId
      })
    }

    const audioFormatId = parseSabrFormatId(activeVariant.originalAudioId)
    const audioSegmentIndex = activeManifestVariant.audio.segmentIndex

    if (streamIsVideo) {
      bufferedRanges.push(createFullBufferRange(audioFormatId))
    } else {
      for (const buffered of bufferedInfo.audio) {
        const range = createBufferedRange(audioFormatId, buffered, audioSegmentIndex, isLive, deliveredLiveStartsMs)
        if (range) bufferedRanges.push(range)
      }
    }

    // Lazily initialize these variables as video data won't exist for audio-only playback
    let videoFormatId
    let videoSegmentIndex

    if (streamIsAudio && bufferedInfo.video.length > 0) {
      videoFormatId = parseSabrFormatId(activeVariant.originalVideoId)
      bufferedRanges.push(createFullBufferRange(videoFormatId))
    } else {
      for (const buffered of bufferedInfo.video) {
        if (!videoFormatId) {
          videoFormatId = parseSabrFormatId(activeVariant.originalVideoId)
        }

        if (!videoSegmentIndex) {
          videoSegmentIndex = activeManifestVariant.video.segmentIndex
        }

        const range = createBufferedRange(videoFormatId, buffered, videoSegmentIndex, isLive, deliveredLiveStartsMs)
        if (range) bufferedRanges.push(range)
      }
    }
  }
}

/**
 * @param {shaka.Player} player
 */
function getBufferedAheadSeconds(player) {
  try {
    const currentTime = player.getMediaElement()?.currentTime ?? 0
    const range = player.getBufferedInfo().total.find(({ start, end }) => start <= currentTime && currentTime < end)
    return range ? range.end - currentTime : 0
  } catch {
    // The player is being destroyed, so this request is about to be aborted
    return 0
  }
}

/**
 * @param {string} uri
 * @param {shaka.extern.Request} request
 * @param {Uint8Array} data
 * @returns {shaka.util.AbortableOperation<shaka.extern.Response>}
 */
function createCacheResponse(uri, request, data) {
  return AbortableOperation.completed({
    data,
    fromCache: true,
    headers: {},
    originalRequest: request,
    originalUri: uri,
    uri
  })
}

/**
 * @param {shaka.util.Error.Code} code
 * @param {...any} args
 */
function createRecoverableNetworkError(code, ...args) {
  return new ShakaError(ShakaError.Severity.RECOVERABLE, ShakaError.Category.NETWORK, code, ...args)
}

/**
 * Shaka retries a failed segment without reporting the attempts, so diagnostic
 * reports would only show the final error. Log each attempt with how much of
 * the segment arrived and how long it took.
 * @param {OperationInputs} operationInputs
 * @param {CurrentState} currentState
 * @param {string} reason
 * @param {{ status?: number, receivedBytes?: number, expectedBytes?: number }} details
 */
function warnSabrRequestFailure(operationInputs, currentState, reason, details = {}) {
  // A request that requests a reload aborts itself, which is not a failure
  if (currentState.abortStatus.playerReloadRequested) return

  const facts = []
  if (details.status !== undefined) facts.push(`HTTP ${details.status}`)
  if (details.receivedBytes !== undefined) {
    facts.push(details.expectedBytes === undefined
      ? `received ${details.receivedBytes} media bytes`
      : `received ${details.receivedBytes} of ${details.expectedBytes} media bytes`)
  }
  facts.push(`after ${Date.now() - currentState.startedAtMs} ms`)
  console.warn(`SABR request ${operationInputs.uri} failed: ${reason} (${facts.join(', ')})`)
}

/**
 * Live segment times are estimates, which a segment shorter than the target
 * duration shifts by up to a segment. SABR answers a time with the segment that
 * contains it, so ask for the requested segment at a time derived from the
 * neighbor SABR sent instead, between the neighbors seen so far.
 * @param {OperationInputs} operationInputs
 * @param {CurrentState} currentState
 * @param {{ sequenceNumber: number, startMs: number }} neighbor
 */
function retargetLiveRequest({ sequenceNumber, targetDurationMs }, currentState, neighbor) {
  const clientAbrState = currentState.abrRequest.clientAbrState
  const bounds = currentState.liveTimeBounds
  if (neighbor.sequenceNumber < sequenceNumber) {
    bounds.afterMs = Math.max(bounds.afterMs, Number(clientAbrState.playerTimeMs))
  } else {
    bounds.beforeMs = Math.min(bounds.beforeMs, neighbor.startMs)
  }

  let timeMs = neighbor.startMs + (sequenceNumber - neighbor.sequenceNumber + 0.5) * targetDurationMs
  if (timeMs <= bounds.afterMs || timeMs >= bounds.beforeMs) {
    // Segments around it differ from the target duration
    const afterMs = Number.isFinite(bounds.afterMs) ? bounds.afterMs : bounds.beforeMs - targetDurationMs
    const beforeMs = Number.isFinite(bounds.beforeMs) ? bounds.beforeMs : bounds.afterMs + targetDurationMs
    timeMs = (afterMs + beforeMs) / 2
  }
  clientAbrState.playerTimeMs = String(Math.round(timeMs))
}

/**
 * @param {SabrStreamState} sabrStreamState
 */
function prepareSabrContexts(sabrStreamState) {
  /** @type {SabrContextUpdate[]} */
  const sabrContexts = []
  /** @type {number[]} */
  const unsentSabrContexts = []

  for (const ctxUpdate of sabrStreamState.sabrContexts.values()) {
    if (sabrStreamState.activeSabrContextTypes.has(ctxUpdate.type)) {
      sabrContexts.push(ctxUpdate)
    } else {
      unsentSabrContexts.push(ctxUpdate.type)
    }
  }

  return { sabrContexts, unsentSabrContexts }
}

/**
 * @param {VideoPlaybackAbrRequest} abrRequest
 * @param {SabrStreamState} sabrStreamState
 */
function encodeAbrRequest(abrRequest, sabrStreamState) {
  return VideoPlaybackAbrRequest.encode({
    ...abrRequest,
    ssapPlaybackInfos: createSsapPlaybackInfos(sabrStreamState.cuepoints.values()),
  }).finish()
}

/**
 * @template T
 * @param {import('googlevideo/ump').CompositeBuffer} data
 * @param {{ decode: (data: Uint8Array) => T }} decoder
 * @returns {T | undefined}
 */
function decodePart(data, decoder) {
  if (!data.chunks.length) return undefined

  try {
    const chunk = data.chunks.length === 1 ? data.chunks[0] : concatenateChunks(data.chunks)
    return decoder.decode(chunk)
  } catch {
    return undefined
  }
}

/**
 * @param {(args: void) => void} callback
 * @param {number} timeoutMs
 * @return TimeoutController
 */
function createTimeoutController(callback, timeoutMs) {
  return {
    _timeout: setTimeout(callback, timeoutMs),
    _resetCount: 0,
    resetTimeoutOnce() {
      if (this._resetCount > 0) return

      this.clearTimeout()
      this._timeout = setTimeout(callback, timeoutMs)
      this._resetCount++
    },
    clearTimeout() {
      clearTimeout(this._timeout)
    },
  }
}

/**
 * @param {number} delayMs
 * @param {AbortSignal} signal
 */
function waitUnlessAborted(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * @param {OperationInputs} operationInputs - readonly
 * @param {CurrentState} currentState - can be updated
 */
async function doRequest(
  operationInputs,
  currentState,
) {
  let response
  let receivedResponseBytes = 0
  /** @type {Uint8Array[]} */
  const responseDataChunks = []
  let segmentComplete = false
  let expectedMediaLength
  let receivedMediaLength = 0
  let shouldRetry = false
  let shouldRetryDueToNextRequestPolicy = false
  let contextUpdateNeedsRetry = false
  let nextRequestBackoffUntilMs = 0
  let nextRequestBackoffTimeMs = 0
  let nextRequestPlaybackCookieBytes
  /** @type {import('./sabrProtocol').SabrLiveHead | undefined} */
  let liveHead
  /**
   * Another live segment of the requested format, sent for the requested time
   * @type {{ sequenceNumber: number, startMs: number } | undefined}
   */
  let neighborSegment
  let mediaSequenceNumber
  let mediaStartMs

  let invalidPoToken = false
  let error
  const warnFailure = (reason) => warnSabrRequestFailure(operationInputs, currentState, reason, {
    status: response?.status,
    receivedBytes: receivedMediaLength,
    expectedBytes: expectedMediaLength,
  })

  if (currentState.sabrStreamState.playerReloadRequested) {
    // Multiple requests might be issued at the same time, other requests should abort themselves once reload requested
    throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
  }

  try {
    let shouldReloadDueToBackoffLoop = false
    let waitedForBackoff = false
    const hasDeliveredMedia = () => currentState.sabrStreamState.deliveredMediaFor.has(operationInputs.streamKind)
    const needsMedia = () => (currentState.getBufferedAheadSeconds?.() ?? 0) < WITHHELD_MEDIA_RELOAD_BUFFER_SECONDS
    while (currentState.sabrStreamState.backoffUntilMs > Date.now()) {
      waitedForBackoff = true
      const currentBackoffTimeMs = currentState.sabrStreamState.backoffUntilMs - Date.now()
      let waitMs = currentBackoffTimeMs
      // The countdown covers the video, so show it only while playback waits
      // on the backoff: before the first media, or once the buffer runs out.
      // At the live edge, SABR paces every segment with a short backoff while
      // a few seconds still play. Captions never hold playback back.
      if (operationInputs.streamKind !== 'text') {
        const bufferedMs = (currentState.getBufferedAheadSeconds?.() ?? 0) * 1000 / (currentState.getPlaybackRate?.() || 1)
        const playableMs = hasDeliveredMedia() ? bufferedMs - BACKOFF_STALL_BUFFER_MS : 0
        if (playableMs > 0) {
          waitMs = Math.min(waitMs, Math.max(playableMs, BACKOFF_BUFFER_POLL_MS))
        } else {
          currentState.eventEmitter.emit('backoff-requested', { backoffMs: currentBackoffTimeMs })
        }
      }
      await waitUnlessAborted(waitMs, currentState.abortController.signal)
      currentState.cumulativeBackOffTimeMs += waitMs
    }
    if (waitedForBackoff) {
      // Must reset AFTER the whole backoff to avoid requested aborted
      // Since long backoff time mostly happens on the start of video playback we only reset timeout once
      // i.e. backoff time parts received will not reset timeout - counted as video loading issue
      currentState.timeoutController?.resetTimeoutOnce()
      currentState.cumulativeBackOffRequested++
      // Pacing is normal once this stream has delivered media. An unstarted
      // video still needs a bounded recovery even when its audio works. One
      // long policy, including extensions from another loader, is not a loop.
      // A session pending attestation only gets about a minute of media, after
      // which YouTube withholds the rest behind backoffs that never end.
      if (
        (currentState.cumulativeBackOffRequested >= BACKOFF_ROUNDS_WITHOUT_MEDIA ||
          (currentState.cumulativeBackOffRequested > 1 &&
            currentState.cumulativeBackOffTimeMs >= BACKOFF_WITHOUT_MEDIA_BUDGET_MS))
      ) {
        if (!hasDeliveredMedia()) {
          shouldReloadDueToBackoffLoop = true
        } else if (currentState.sabrStreamState.attestationPending) {
          currentState.sabrStreamState.mediaWithheld = true
        }
      }
    }
    if (!shouldReloadDueToBackoffLoop && currentState.sabrStreamState.mediaWithheld) {
      // Requests can't get withheld media, and a reload interrupts buffered
      // playback too. Wait without either until playback needs more media,
      // which a paused video may never do.
      currentState.timeoutController?.clearTimeout()
      while (!needsMedia() && !currentState.sabrStreamState.playerReloadRequested) {
        await waitUnlessAborted(WITHHELD_MEDIA_POLL_MS, currentState.abortController.signal)
      }
      if (currentState.sabrStreamState.playerReloadRequested) {
        currentState.abortStatus.playerReloadRequested = true
        throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
      }
      shouldReloadDueToBackoffLoop = true
    }
    if ((shouldReloadDueToBackoffLoop || currentState.cumulativeRetries >= 100) && operationInputs.streamKind === 'text') {
      // Stuck captions skip their segment. A reload or a failed text request
      // would stop the audio and video that still play.
      warnFailure('captions kept backing off, skipping the segment')
      /** @type {shaka.extern.Response} */
      return {
        uri: operationInputs.uri,
        originalUri: operationInputs.uri,
        data: new Uint8Array(0),
        status: 200,
        headers: {},
        fromCache: false,
        originalRequest: operationInputs.request,
      }
    }
    if (shouldReloadDueToBackoffLoop || currentState.cumulativeRetries >= 100) {
      // Fire fake reload event due to detecting retry loop
      currentState.sabrStreamState.playerReloadRequested = true
      if (!currentState.abortController.signal.aborted) {
        console.warn(
          'Reloading the SABR stream after a retry loop.\n' +
          `Backoffs: ${currentState.cumulativeBackOffRequested} (${currentState.cumulativeBackOffTimeMs} ms)\n` +
          `Retries: ${currentState.cumulativeRetries}`
        )
        currentState.abortStatus.playerReloadRequested = true
        currentState.abortController.abort()
        currentState.eventEmitter.emit('reload')
      }
      throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
    }

    // Redirects and retry policies send a new request; time each one separately
    currentState.startedAtMs = Date.now()
    const sabrURL = new URL(currentState.sabrStreamState.sabrUrl)
    sabrURL.searchParams.set('rn', String(currentState.sabrStreamState.requestNumber++))
    if (process.env.IS_CAPACITOR) {
      const { capacitorSabrFetch } = await import('../api/capacitor-sabr-http')
      response = await fetchGoogleVideo(sabrURL.toString(), currentState.requestInit, capacitorSabrFetch)
    } else {
      response = await fetchGoogleVideo(sabrURL.toString(), currentState.requestInit, fetch)
    }
    // Android's native transport answers a connection failure with this
    // header, so it fails like a lost connection instead of a server's 502.
    if (response.headers.has('X-OpenTubeX-Connection-Failed')) {
      throw new Error('Connection to the googlevideo server failed')
    }

    operationInputs.headersReceived({})

    const requestedFormatId = parseSabrFormatId(operationInputs.formatIdString)
    let mediaHeaderId

    const umpReader = createSabrUmpReader({
      onPart: (type, data) => {
        // MEDIA_END completes this request and aborts its response. A WebView
        // can deliver later parts in the same chunk; ignore them just as we
        // ignore later chunks, so they cannot change another loader's backoff.
        if (currentState.abortStatus.finished) return

        switch (type) {
          case UMPPartId.STREAM_PROTECTION_STATUS: {
            const streamProtectionStatus = decodePart(data, StreamProtectionStatus)
            if (!streamProtectionStatus) break

            currentState.sabrStreamState.attestationPending = streamProtectionStatus.status === 2
            if (streamProtectionStatus.status === 2) {
              // The watch page's session may be trusted more, so load the next videos through it
              disableDirectPlayer('SABR reported a session pending attestation')
            }
            if (streamProtectionStatus.status === 3) {
              invalidPoToken = true
            }
            break
          }
          case UMPPartId.SABR_ERROR: {
            const sabrError = decodePart(data, SabrError)
            if (!sabrError) break

            error = `SABR Error: type: ${sabrError.type}, code: ${sabrError.code}`
            break
          }
          case UMPPartId.SABR_REDIRECT: {
            const sabrRedirect = decodePart(data, SabrRedirect)
            if (!sabrRedirect?.url) break

            currentState.sabrStreamState.sabrUrl = sabrRedirect.url
            shouldRetry = true
            break
          }
          case UMPPartId.MEDIA_HEADER: {
            if (mediaHeaderId === undefined) {
              const mediaHeader = decodePart(data, MediaHeader)
              if (!mediaHeader) break
              // Omitted proto3 fields are zero, but googlevideo leaves them undefined
              const { headerId = 0, segmentNum = 0, startMs = '0' } = mediaHeader

              if (isSameSabrFormat(mediaHeader.formatId, requestedFormatId)) {
                if (
                  (operationInputs.isInit && mediaHeader.isInitializationSegment) ||
                  (!operationInputs.isInit && !mediaHeader.isInitializationSegment &&
                    (operationInputs.isLiveLookup || segmentNum === operationInputs.sequenceNumber))
                ) {
                  mediaHeaderId = headerId
                  mediaSequenceNumber = segmentNum
                  mediaStartMs = Number(startMs)
                  if (mediaHeader.segmentLengthBytes !== undefined) {
                    expectedMediaLength = Number(mediaHeader.segmentLengthBytes)
                  }
                } else if (operationInputs.targetDurationMs && !mediaHeader.isInitializationSegment) {
                  neighborSegment ??= { sequenceNumber: segmentNum, startMs: Number(startMs) }
                }
              }
            }

            break
          }
          case UMPPartId.MEDIA: {
            const [headerId, dataOffset] = readUmpVarInt(data)
            if (mediaHeaderId === headerId) {
              const chunks = data.split(dataOffset).remainingBuffer.chunks
              responseDataChunks.push(...chunks)
              for (const chunk of chunks) receivedMediaLength += chunk.byteLength
            }
            break
          }
          case UMPPartId.MEDIA_END: {
            const [headerId] = readUmpVarInt(data)
            if (mediaHeaderId === headerId) {
              if (expectedMediaLength !== undefined && receivedMediaLength !== expectedMediaLength) {
                error ??= `SABR segment length mismatch: expected ${expectedMediaLength}, received ${receivedMediaLength}`
              } else {
                segmentComplete = true
              }
              currentState.abortStatus.finished = true
              currentState.abortController.abort()
            }
            break
          }
          case UMPPartId.NEXT_REQUEST_POLICY: {
            const nextRequestPolicy = decodePart(data, NextRequestPolicy)
            if (!nextRequestPolicy) break

            shouldRetry = true
            shouldRetryDueToNextRequestPolicy = true

            // Audio and video loaders can reach this policy at different times.
            // Count from receipt so each loader waits only the remaining time,
            // and later segments do not repeat a delay that already elapsed.
            nextRequestBackoffTimeMs = nextRequestPolicy.backoffTimeMs || 0
            nextRequestBackoffUntilMs = Date.now() + nextRequestBackoffTimeMs
            nextRequestPlaybackCookieBytes = nextRequestPolicy.playbackCookie
            break
          }
          case UMPPartId.FORMAT_INITIALIZATION_METADATA: {
            break
          }
          case UMPPartId.CUEPOINT_LIST: {
            // Keep reporting a break after its STOP event: SABR withholds the
            // segment that ends the break until the request reports it
            const { cuepoints } = currentState.sabrStreamState
            for (const cuepoint of decodePart(data, { decode: parseSabrCuepoints }) ?? []) {
              if (cuepoints.has(cuepoint.identifier)) continue

              cuepoints.set(cuepoint.identifier, cuepoint)
              if (cuepoints.size > MAX_REPORTED_CUEPOINTS) cuepoints.delete(cuepoints.keys().next().value)
            }
            break
          }
          case UMPPartId.LIVE_METADATA: {
            const liveMetadata = decodePart(data, SabrLiveMetadata)
            const head = liveMetadata && parseSabrLiveHead(liveMetadata, Date.now())
            if (!head) break

            publishSabrLiveHead(currentState.scheme, head)
            if (operationInputs.isLiveHead) {
              // The head arrives before the media at the live edge, which is not needed
              liveHead = head
              currentState.abortStatus.finished = true
              currentState.abortController.abort()
            }
            break
          }
          case UMPPartId.SABR_CONTEXT_UPDATE: {
            const sabrContextUpdate = decodePart(data, SabrContextUpdate)
            if (!sabrContextUpdate) break

            if (sabrContextUpdate.type !== undefined && sabrContextUpdate.value?.length) {
              if (
                sabrContextUpdate.writePolicy !== SabrContextWritePolicy.KEEP_EXISTING ||
                !currentState.sabrStreamState.sabrContexts.has(sabrContextUpdate.type)
              ) {
                currentState.sabrStreamState.sabrContexts.set(sabrContextUpdate.type, sabrContextUpdate)
              }

              // Activation applies even when KEEP_EXISTING retains the value.
              if (sabrContextUpdate.sendByDefault) {
                currentState.sabrStreamState.activeSabrContextTypes.add(sabrContextUpdate.type)
              }
              contextUpdateNeedsRetry = true
            }
            break
          }
          case UMPPartId.SABR_CONTEXT_SENDING_POLICY: {
            const sabrContextSendingPolicy = decodePart(data, SabrContextSendingPolicy)
            if (!sabrContextSendingPolicy) break

            for (const startPolicy of sabrContextSendingPolicy.startPolicy) {
              if (!currentState.sabrStreamState.activeSabrContextTypes.has(startPolicy)) {
                currentState.sabrStreamState.activeSabrContextTypes.add(startPolicy)
              }
            }

            for (const stopPolicy of sabrContextSendingPolicy.stopPolicy) {
              if (currentState.sabrStreamState.activeSabrContextTypes.has(stopPolicy)) {
                currentState.sabrStreamState.activeSabrContextTypes.delete(stopPolicy)
              }
            }

            for (const discardPolicy of sabrContextSendingPolicy.discardPolicy) {
              if (currentState.sabrStreamState.sabrContexts.has(discardPolicy)) {
                currentState.sabrStreamState.sabrContexts.delete(discardPolicy)
              }
            }
            break
          }
          case UMPPartId.RELOAD_PLAYER_RESPONSE: {
            const reloadPlaybackContext = decodePart(data, ReloadPlaybackContext)
            if (!reloadPlaybackContext) break

            // Whole video cannot be played
            currentState.sabrStreamState.playerReloadRequested = true
            if (!currentState.abortController.signal.aborted) {
              console.warn('Reloading the SABR stream because YouTube requested it')
              currentState.abortStatus.playerReloadRequested = true
              currentState.abortController.abort()
              currentState.eventEmitter.emit('reload', reloadPlaybackContext)
            }
            break
          }
          default: {
            break
          }
        }
      }
    })

    const reader = response.body.getReader()
    let readObj = await reader.read()

    while (!readObj.done && !currentState.abortStatus.finished) {
      receivedResponseBytes += readObj.value.byteLength
      if (receivedResponseBytes > MAX_SABR_RESPONSE_BYTES) {
        throw new Error('SABR response exceeds the size limit')
      }

      await umpReader.feed(readObj.value)

      if (!currentState.abortStatus.finished) {
        readObj = await reader.read()
      }
    }
  } catch (error) {
    // A parser rejection must also stop the response body, rather than leave
    // the network request downloading after Shaka receives the error.
    currentState.abortController.abort()
    if (currentState.abortStatus.cancelled || currentState.abortStatus.playerReloadRequested) {
      throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
    } else if (currentState.abortStatus.timedOut) {
      warnFailure('timed out')
      throw createRecoverableNetworkError(ShakaError.Code.TIMEOUT, operationInputs.uri, operationInputs.requestType)
    } else if (!currentState.abortStatus.finished) {
      warnFailure(`connection error: ${error?.message ?? error}`)
      throw createRecoverableNetworkError(ShakaError.Code.HTTP_ERROR, operationInputs.uri, error, operationInputs.requestType)
    }
  }

  if (currentState.abortStatus.cancelled || currentState.abortStatus.playerReloadRequested) {
    throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
  } else if (currentState.abortStatus.timedOut) {
    warnFailure('timed out')
    throw createRecoverableNetworkError(ShakaError.Code.TIMEOUT, operationInputs.uri, operationInputs.requestType)
  }

  if (!response.ok) {
    warnFailure('bad HTTP status')
    const severity = response.status === 401 || response.status === 403
      ? ShakaError.Severity.CRITICAL
      : ShakaError.Severity.RECOVERABLE

    throw new ShakaError(
      severity,
      ShakaError.Category.NETWORK,
      ShakaError.Code.BAD_HTTP_STATUS,
      operationInputs.uri,
      response.status,
      '',
      {},
      operationInputs.requestType,
      operationInputs.uri,
    )
  }

  if (liveHead) {
    if (nextRequestPlaybackCookieBytes !== undefined) {
      currentState.sabrStreamState.playbackCookieBytes = nextRequestPlaybackCookieBytes
    }

    /** @type {shaka.extern.Response} */
    return {
      uri: operationInputs.uri,
      originalUri: operationInputs.uri,
      data: encodeSabrLiveHead(liveHead),
      status: response.status,
      headers: {},
      fromCache: false,
      originalRequest: operationInputs.request,
    }
  } else if (responseDataChunks.length > 0 && segmentComplete) {
    if (!operationInputs.isInit) {
      currentState.sabrStreamState.deliveredMediaFor.add(operationInputs.streamKind)
    }
    if (operationInputs.targetDurationMs) {
      currentState.sabrStreamState.lastLiveSegments.set(operationInputs.streamKind, {
        liveWindowSequenceNumber: operationInputs.liveWindowSequenceNumber,
        liveWindowGeneration: operationInputs.liveWindowGeneration,
        sequenceNumber: mediaSequenceNumber,
        startMs: mediaStartMs,
      })
    }
    // Caption segments can start apart from the media segments with their sequence number
    if (operationInputs.targetDurationMs && operationInputs.streamKind !== 'text') {
      const { deliveredLiveStartsMs } = currentState.sabrStreamState
      // Refresh the order, which decides what to forget first
      deliveredLiveStartsMs.delete(mediaSequenceNumber)
      deliveredLiveStartsMs.set(mediaSequenceNumber, mediaStartMs)
      if (deliveredLiveStartsMs.size > MAX_DELIVERED_LIVE_SEGMENTS) {
        deliveredLiveStartsMs.delete(deliveredLiveStartsMs.keys().next().value)
      }
      // The live window re-times its segments before the player asks for the next one
      publishSabrLiveSegment(currentState.scheme, {
        windowSequenceNumber: operationInputs.liveWindowSequenceNumber,
        windowGeneration: operationInputs.liveWindowGeneration,
        sequenceNumber: mediaSequenceNumber,
        startMs: mediaStartMs,
      })
    }
    if (shouldRetryDueToNextRequestPolicy && nextRequestPlaybackCookieBytes !== undefined) {
      // Policies received before MEDIA_END can establish the session cookie
      // even when this request succeeds. Subsequent audio/video requests must
      // carry it, including the first segments fetched at a resume position.
      currentState.sabrStreamState.playbackCookieBytes = nextRequestPlaybackCookieBytes
    }
    const data = /** @__NOINLINE__ */ concatenateChunks(responseDataChunks)

    if (operationInputs.isInit) {
      currentState.initDataCache.set(operationInputs.formatIdString, data)
    }

    /** @type {shaka.extern.Response} */
    return {
      uri: operationInputs.uri,
      originalUri: operationInputs.uri,
      data,
      status: response.status,
      headers: {},
      fromCache: false,
      originalRequest: operationInputs.request,
    }
  } else if (invalidPoToken) {
    warnFailure('invalid PO token')
    throw new ShakaError(
      ShakaError.Severity.CRITICAL,
      ShakaError.Category.NETWORK,
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Invalid PO token'),
      operationInputs.requestType,
    )
  } else if (error) {
    warnFailure(error)
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error(error),
      operationInputs.requestType,
    )
  } else if (responseDataChunks.length > 0 && !segmentComplete) {
    warnFailure('response ended before MEDIA_END')
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Incomplete segment, missing MEDIA_END part'),
      operationInputs.requestType,
    )
  } else if (shouldRetry || contextUpdateNeedsRetry || neighborSegment) {
    // Context-only handshakes must echo the supplied context, with the same
    // retry limit as policy responses so neither can loop indefinitely.
    currentState.cumulativeRetries++
    if (neighborSegment) {
      retargetLiveRequest(operationInputs, currentState, neighborSegment)
    }
    if (shouldRetryDueToNextRequestPolicy) {
      currentState.sabrStreamState.backoffUntilMs = nextRequestBackoffUntilMs
      if (nextRequestPlaybackCookieBytes !== undefined) {
        currentState.sabrStreamState.playbackCookieBytes = nextRequestPlaybackCookieBytes
      }
      currentState.abrRequest.streamerContext.playbackCookie = currentState.sabrStreamState.playbackCookieBytes
      currentState.abrRequest.streamerContext.backoffTimeMs = nextRequestBackoffTimeMs
    }

    const { sabrContexts, unsentSabrContexts } = prepareSabrContexts(currentState.sabrStreamState)

    currentState.abrRequest.streamerContext.sabrContexts = sabrContexts
    currentState.abrRequest.streamerContext.unsentSabrContexts = unsentSabrContexts

    let body

    try {
      body = encodeAbrRequest(currentState.abrRequest, currentState.sabrStreamState)
    } catch (error) {
      console.error('Invalid VideoPlaybackAbrRequest data', currentState.abrRequest)
      throw error
    }

    const previousBody = currentState.requestInit.body
    // Context-only handshakes need a changed request to make progress.
    // Explicit retry policies and redirects still apply to unchanged bodies.
    if (!shouldRetry && body.length === previousBody.length && body.every((byte, index) => byte === previousBody[index])) {
      warnFailure('context update did not change the playback request')
      throw createRecoverableNetworkError(ShakaError.Code.HTTP_ERROR, operationInputs.uri, operationInputs.requestType)
    }

    currentState.requestInit = {
      body,
      method: 'POST',
      headers: {
        'content-type': 'application/x-protobuf',
        'accept-encoding': 'identity',
        accept: 'application/vnd.yt-ump',
      },
      signal: currentState.abortController.signal,
    }
    currentState.abortStatus.timedOut = false

    currentState.abortStatus.finished = false
    if (
      shouldRetryDueToNextRequestPolicy && !nextRequestBackoffTimeMs && operationInputs.targetDurationMs &&
      !neighborSegment && !contextUpdateNeedsRetry
    ) {
      try {
        await waitUnlessAborted(LIVE_SEGMENT_POLL_MS, currentState.abortController.signal)
      } catch {
        if (currentState.abortStatus.timedOut) {
          warnFailure('timed out')
          throw createRecoverableNetworkError(ShakaError.Code.TIMEOUT, operationInputs.uri, operationInputs.requestType)
        }
        throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
      }
    }
    return doRequest(operationInputs, currentState)
  } else {
    warnFailure('empty response')
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Empty response, this should not happen'),
      operationInputs.requestType,
    )
  }
}

/**
 * @param {import('../../views/Watch/Watch').SabrData} sabrData
 * @param {() => shaka.Player} getPlayer
 * @param {() => shaka.extern.Manifest} getManifest
 * @param {import('vue').ComputedRef<number>} playerWidth
 * @param {import('vue').ComputedRef<number>} playerHeight
 * @return SabrStream
 */
export function setupSabrScheme(sabrData, getPlayer, getManifest, playerWidth, playerHeight) {
  const transport = createSabrTransport(sabrData, (uri, request) => {
    // lazily fetch it as the variable is only set after setupSabrScheme is called
    // but it will definitely exist when we receive a request here.
    const player = getPlayer()
    if (player == null) {
      // This is true during reload, returning a promise to suppress error
      return null
    }

    let isAudioOnly
    try {
      isAudioOnly = player.isAudioOnly()
    } catch {
      // Shaka keeps the cast proxy reachable after destroying its sender. A
      // request queued before teardown can therefore throw on property access.
      return null
    }

    const url = new URL(request.uris[0])

    if (url.pathname === 'live') {
      // Requested while parsing the manifest, so no variant exists yet
      return {
        audioFormatId: parseSabrFormatId(url.searchParams.get('formatId')),
        videoFormatId: parseSabrFormatId(url.searchParams.get('videoFormatId')),
        bufferedRanges: [],
        drcEnabled: false,
        enableVoiceBoost: false,
        bandwidthEstimate: 0,
        playbackRate: 1,
        width: playerWidth.value,
        height: playerHeight.value,
        getBufferedAheadSeconds: () => 0,
        getPlaybackRate: () => 1,
      }
    }

    const isInit = url.searchParams.has('init')
    const formatIdString = url.searchParams.get('formatId')

    const variantTracks = player.getVariantTracks()
    const activeVariant = variantTracks.find(track => track.active)

    const streamIsAudio = url.pathname === 'audio'
    const streamIsVideo = url.pathname === 'video'
    const streamIsText = url.pathname === 'text'

    let audioFormatId
    let videoFormatId
    let captionFormatId

    if (streamIsAudio) {
      audioFormatId = parseSabrFormatId(formatIdString)

      if (isAudioOnly) {
        // We need to specify a video format even for audio only otherwise we get an error response
        videoFormatId = parseSabrFormatId(url.searchParams.get('videoFormatId'))
      } else {
        videoFormatId = parseSabrFormatId((activeVariant ?? variantTracks[0]).originalVideoId)
      }
    } else if (streamIsVideo) {
      videoFormatId = parseSabrFormatId(formatIdString)

      // for the first fetching of the initial data there won't be an active variant
      // (shaka-player only sets it to active after it has fetched the init/segment data)
      if (activeVariant) {
        audioFormatId = parseSabrFormatId(activeVariant.originalAudioId)
      } else {
        const candidates = variantTracks.filter((track) => track.audioRoles.includes('main'))

        const probableAudioFormat = candidates.reduce((previous, current) => {
          return current.audioBandwidth >= previous.audioBandwidth ? current : previous
        }, candidates[0])

        audioFormatId = parseSabrFormatId(probableAudioFormat.originalAudioId)
      }
    } else if (streamIsText) {
      captionFormatId = parseSabrFormatId(formatIdString)

      const variant = activeVariant ?? variantTracks[0]
      audioFormatId = parseSabrFormatId(variant.originalAudioId)
      videoFormatId = parseSabrFormatId(isAudioOnly ? url.searchParams.get('videoFormatId') : variant.originalVideoId)
    }

    /** @type {import('googlevideo/protos').BufferedRange[]} */
    const bufferedRanges = []

    if (streamIsText) {
      // SABR only sends captions together with audio and video, so report both as buffered
      bufferedRanges.push(createFullBufferRange(audioFormatId), createFullBufferRange(videoFormatId))
    } else if (!isInit && activeVariant) {
      /** @__NOINLINE__ */ fillBufferedRanges(player, getManifest(), isAudioOnly, streamIsVideo, streamIsAudio, bufferedRanges, activeVariant, transport.deliveredLiveStartsMs)
    }

    const drcEnabled = url.searchParams.has('drc') || !!(activeVariant && activeVariant.audioRoles.includes('drc'))
    const enableVoiceBoost = url.searchParams.has('vb') || !!(activeVariant && activeVariant.audioRoles.includes('voice-boost'))

    return {
      audioFormatId,
      videoFormatId,
      captionFormatId,
      bufferedRanges,
      drcEnabled,
      enableVoiceBoost,
      bandwidthEstimate: player.getStats().estimatedBandwidth,
      playbackRate: player.getPlaybackRate(),
      width: playerWidth.value,
      height: playerHeight.value,
      getBufferedAheadSeconds: () => getBufferedAheadSeconds(player),
      getPlaybackRate: () => player.getPlaybackRate(),
    }
  })
  shaka.net.NetworkingEngine.registerScheme(sabrData.scheme, transport.request)
  return {
    ...transport,
    cleanup() {
      shaka.net.NetworkingEngine.unregisterScheme(sabrData.scheme)
      transport.cleanup()
    },
  }
}

/**
 * Shared SABR wire transport. The decoder supplies its selected formats and
 * playback state; neither protocol handling nor fetching requires a Shaka player.
 */
export function createSabrTransport(sabrData, getRequestContext) {
  const eventEmitter = new EventEmitterLike()

  /**
   * Caches the init data until the video ends
   * that way changing qualities and between audio and DASH
   * doesn't have to fetch the init data and segment index again
   * @type {Map<string, Uint8Array>}
   */
  const initDataCache = new Map()
  const operations = new Set()
  let cleanedUp = false

  const poToken = base64ToU8(sabrData.poToken)
  const videoPlaybackUstreamerConfig = base64ToU8(sabrData.ustreamerConfig)
  const clientInfo = JSON.parse(JSON.stringify(sabrData.clientInfo))

  /** @type {SabrStreamState} */
  const sabrStreamState = {
    sabrUrl: sabrData.url,
    activeSabrContextTypes: new Set(),
    sabrContexts: new Map(),
    backoffUntilMs: 0,
    playbackCookieBytes: undefined,
    playerReloadRequested: false,
    requestNumber: 0,
    deliveredMediaFor: new Set(),
    attestationPending: false,
    mediaWithheld: false,
    cuepoints: new Map(),
    deliveredLiveStartsMs: new Map(),
    lastLiveSegments: new Map(),
  }

  const requestSegment = (uri, request, requestType, _progressUpdated, headersReceived = () => {}) => {
    const context = cleanedUp ? null : getRequestContext(uri, request)
    if (!context) {
      return AbortableOperation.completed(createAbandonedSabrResponse(uri, request))
    }
    const url = new URL(request.uris[0])
    const isInit = url.searchParams.has('init')
    const formatIdString = url.searchParams.get('formatId')
    if (isInit && initDataCache.has(formatIdString)) {
      return createCacheResponse(uri, request, initDataCache.get(formatIdString))
    }
    const streamIsAudio = url.pathname === 'audio'
    const streamIsVideo = url.pathname === 'video'
    const isLiveHead = url.pathname === 'live'
    const resolution = streamIsVideo ? parseInt(url.searchParams.get('resolution')) : undefined
    let playerTimeMs = isLiveHead ? SABR_LIVE_HEAD_TIME_MS : url.searchParams.get('startTimeMs') ?? '0'
    const liveWindowSequenceNumber = parseInt(url.searchParams.get('sq'))
    const liveWindowGeneration = Number(url.searchParams.get('windowGeneration') ?? 0)
    let sequenceNumber = liveWindowSequenceNumber
    const targetDurationMs = Number(url.searchParams.get('targetDurationMs')) || undefined
    let isLiveLookup = false
    if (targetDurationMs) {
      // The live window estimates segment times from the target duration, but
      // segments can be shorter, by seconds over minutes of footage. Continue
      // after the segment delivered for the previous estimate. Anything else,
      // such as a seek or captions turned on, starts with the segment that
      // contains the requested time, which is where SABR places it.
      const previous = sabrStreamState.lastLiveSegments.get(url.pathname)
      // Re-timing renumbers the window, so earlier numbers say nothing about the order
      if (previous?.liveWindowGeneration === liveWindowGeneration && previous.liveWindowSequenceNumber === liveWindowSequenceNumber - 1) {
        sequenceNumber = previous.sequenceNumber + 1
        if (Number.isFinite(previous.startMs)) {
          playerTimeMs = String(Math.round(previous.startMs + 1.5 * targetDurationMs))
        }
      } else {
        isLiveLookup = true
      }
    }
    const { audioFormatId, videoFormatId, captionFormatId, bufferedRanges, drcEnabled, enableVoiceBoost } = context

    const { sabrContexts, unsentSabrContexts } = prepareSabrContexts(sabrStreamState)

    /** @type {VideoPlaybackAbrRequest} */
    const requestData = {
      clientAbrState: {
        bandwidthEstimate: String(Math.round(context.bandwidthEstimate)),
        timeSinceLastManualFormatSelectionMs: streamIsVideo ? '0' : undefined,
        stickyResolution: resolution,
        lastManualSelectedResolution: resolution,
        playbackRate: context.playbackRate,
        enabledTrackTypesBitfield: captionFormatId ? ENABLED_TRACK_TYPES_WITH_CAPTIONS : streamIsAudio ? 1 : 0,
        drcEnabled,
        enableVoiceBoost,
        playerTimeMs,
        clientViewportWidth: context.width,
        clientViewportHeight: context.height,
        clientViewportIsFlexible: false
      },
      selectedAudioFormatIds: [audioFormatId],
      selectedVideoFormatIds: [videoFormatId],
      selectedCaptionFormatIds: captionFormatId ? [captionFormatId] : [],
      initializationFormatIds: isInit ? [] : [audioFormatId, videoFormatId, ...(captionFormatId ? [captionFormatId] : [])],
      bufferedRanges,
      streamerContext: {
        poToken,
        clientInfo,
        sabrContexts,
        unsentSabrContexts,
        playbackCookie: sabrStreamState.playbackCookieBytes,
      },
      field1000: [],
      videoPlaybackUstreamerConfig,
    }

    let body

    try {
      body = encodeAbrRequest(requestData, sabrStreamState)
    } catch (error) {
      console.error('Invalid VideoPlaybackAbrRequest data', requestData)
      throw error
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {OperationInputs}
     */
    const opInputs = {
      uri,
      request,
      requestType,
      headersReceived,

      formatIdString,
      isInit,
      isLiveHead,
      sequenceNumber,
      isLiveLookup,
      liveWindowSequenceNumber,
      liveWindowGeneration,
      targetDurationMs,
      streamKind: url.pathname,
    }

    const abortController = new AbortController()

    /** @type {RequestInit & {body: Uint8Array}} */
    const init = {
      body,
      method: 'POST',
      headers: {
        'content-type': 'application/x-protobuf',
        'accept-encoding': 'identity',
        accept: 'application/vnd.yt-ump',
      },
      signal: abortController.signal,
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {AbortStatus}
     */
    const abortStatus = {
      cancelled: false,
      timedOut: false,
      playerReloadRequested: false,
      finished: false,
    }

    const timeoutMs = request.retryParameters.timeout
    let timeoutController = null
    if (timeoutMs) {
      timeoutController = createTimeoutController(() => {
        abortStatus.timedOut = true
        abortController.abort()
      }, timeoutMs)
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {CurrentState}
     */
    const currentState = {
      initDataCache,
      abrRequest: requestData,
      requestInit: init,
      abortStatus: abortStatus,
      abortController,
      sabrStreamState,
      timeoutController,
      eventEmitter,
      cumulativeBackOffTimeMs: 0,
      cumulativeBackOffRequested: 0,
      cumulativeRetries: 0,
      startedAtMs: Date.now(),
      getBufferedAheadSeconds: context.getBufferedAheadSeconds,
      getPlaybackRate: context.getPlaybackRate,
      scheme: sabrData.scheme,
      liveTimeBounds: { afterMs: -Infinity, beforeMs: Infinity },
    }

    const pendingRequest = doRequest(opInputs, currentState)

    const op = new AbortableOperation(pendingRequest, () => {
      abortStatus.cancelled = true
      abortController.abort()
      return Promise.resolve()
    })

    operations.add(op)
    op.finally(() => {
      timeoutController?.clearTimeout()
      operations.delete(op)
    })

    return op
  }

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true

    for (const operation of operations) operation.abort()
    operations.clear()
    initDataCache.clear()
  }

  return {
    request: requestSegment,
    onBackoffRequested(callback) {
      eventEmitter.on('backoff-requested', callback)
    },
    onReloadOnce(callback) {
      eventEmitter.once('reload', callback)
    },
    getUrl: () => sabrStreamState.sabrUrl,
    deliveredLiveStartsMs: sabrStreamState.deliveredLiveStartsMs,
    cleanup,
  }
}
