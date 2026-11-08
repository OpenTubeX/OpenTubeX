import { base64ToU8, concatenateChunks, EventEmitterLike, MAX_INT32_VALUE } from 'googlevideo/utils'
import { CompositeBuffer, UmpReader } from 'googlevideo/ump'
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
} from 'googlevideo/protos'
import shaka from 'shaka-player'

import {
  createAbandonedSabrResponse,
  extractRawProtobufField,
  MAX_SABR_RESPONSE_BYTES,
  parseSabrFormatId,
  readCompleteUmpParts
} from './sabrProtocol'
import { fetchGoogleVideo } from './googleVideoFallback'

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
 * @property {number} sequenceNumber
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
 * @property {() => void | undefined} cleanup
 */

/** NextRequestPolicy.playbackCookie, field 7. */
const PLAYBACK_COOKIE_FIELD_NUMBER = 7
/** MediaHeader.contentLength, field 14. */
const MEDIA_CONTENT_LENGTH_FIELD_NUMBER = 14

const BACKOFF_WITHOUT_MEDIA_BUDGET_MS = 20_000
const BACKOFF_ROUNDS_WITHOUT_MEDIA = 6
/** Leaves time for a reload before playback runs out of withheld media. */
const WITHHELD_MEDIA_RELOAD_BUFFER_SECONDS = 10
const WITHHELD_MEDIA_POLL_MS = 1000

/**
 * @param {import('googlevideo/protos').FormatId} formatId
 * @param {shaka.extern.BufferedRange} buffered
 * @param {shaka.media.SegmentIndex} segmentIndex
 */
function createBufferedRange(formatId, buffered, segmentIndex) {
  const startSegmentIndex = segmentIndex.find(buffered.start) ?? 0
  let endSegmentIndex = segmentIndex.find(buffered.end)
  if (endSegmentIndex == null) {
    // Using Last end time will get `null` in `segmentIndex.find`
    endSegmentIndex = segmentIndex.getNumReferences() - 1
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
 */
function fillBufferedRanges(player, manifest, audioFormatsActive, streamIsVideo, streamIsAudio, bufferedRanges, activeVariant) {
  const bufferedInfo = player.getBufferedInfo()

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
        bufferedRanges.push(createBufferedRange(audioFormatId, buffered, audioSegmentIndex))
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

        bufferedRanges.push(createBufferedRange(videoFormatId, buffered, videoSegmentIndex))
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
 * @template T
 * @param {import('googlevideo/shared-types').Part} part
 * @param {{ decode: (data: Uint8Array) => T }} decoder
 * @returns {T | undefined}
 */
function decodePart(part, decoder) {
  if (!part.data.chunks.length) return undefined

  try {
    const chunk = part.data.chunks.length === 1 ? part.data.chunks[0] : concatenateChunks(part.data.chunks)
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
  /** @type {CompositeBuffer | null} */
  let chunkedDataBuffer = null
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
      // The countdown covers the video, so keep it for playback that waits on it
      if (!hasDeliveredMedia() || needsMedia()) {
        currentState.eventEmitter.emit('backoff-requested', { backoffMs: currentBackoffTimeMs })
      }
      await waitUnlessAborted(currentBackoffTimeMs, currentState.abortController.signal)
      // Must reset AFTER waiting to avoid requested aborted
      // Since long backoff time mostly happens on the start of video playback we only reset timeout once
      // i.e. backoff time parts received will not reset timeout - counted as video loading issue
      currentState.timeoutController?.resetTimeoutOnce()

      currentState.cumulativeBackOffTimeMs += currentBackoffTimeMs
    }
    if (waitedForBackoff) {
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

    operationInputs.headersReceived({})

    const { itag, lastModified, xtags } = parseSabrFormatId(operationInputs.formatIdString)
    let mediaHeaderId

    const reader = response.body.getReader()
    let readObj = await reader.read()

    while (!readObj.done && !currentState.abortStatus.finished) {
      receivedResponseBytes += readObj.value.byteLength
      if (receivedResponseBytes > MAX_SABR_RESPONSE_BYTES) {
        throw new Error('SABR response exceeds the size limit')
      }
      if (chunkedDataBuffer) {
        chunkedDataBuffer.append(readObj.value)
      } else {
        chunkedDataBuffer = new CompositeBuffer([readObj.value])
      }

      const remainingData = readCompleteUmpParts(chunkedDataBuffer, (part) => {
        // MEDIA_END completes this request and aborts its response. A WebView
        // can deliver later parts in the same chunk; ignore them just as we
        // ignore later chunks, so they cannot change another loader's backoff.
        if (currentState.abortStatus.finished) return

        switch (part.type) {
          case UMPPartId.STREAM_PROTECTION_STATUS: {
            const streamProtectionStatus = decodePart(part, StreamProtectionStatus)
            if (!streamProtectionStatus) break

            currentState.sabrStreamState.attestationPending = streamProtectionStatus.status === 2
            if (streamProtectionStatus.status === 3) {
              invalidPoToken = true
            }
            break
          }
          case UMPPartId.SABR_ERROR: {
            const sabrError = decodePart(part, SabrError)
            if (!sabrError) break

            error = `SABR Error: type: ${sabrError.type}, code: ${sabrError.code}`
            break
          }
          case UMPPartId.SABR_REDIRECT: {
            const sabrRedirect = decodePart(part, SabrRedirect)
            if (!sabrRedirect?.url) break

            currentState.sabrStreamState.sabrUrl = sabrRedirect.url
            shouldRetry = true
            break
          }
          case UMPPartId.MEDIA_HEADER: {
            if (mediaHeaderId === undefined) {
              const mediaHeader = decodePart(part, MediaHeader)
              if (!mediaHeader) break

              if (
                mediaHeader.formatId.itag === itag &&
                mediaHeader.formatId.lastModified === lastModified &&
                mediaHeader.formatId.xtags === xtags
              ) {
                if (
                  (operationInputs.isInit && mediaHeader.isInitSeg) ||
                  (!operationInputs.isInit && !mediaHeader.isInitSeg && mediaHeader.sequenceNumber === operationInputs.sequenceNumber)
                ) {
                  mediaHeaderId = mediaHeader.headerId
                  const rawHeader = part.data.chunks.length === 1
                    ? part.data.chunks[0]
                    : concatenateChunks(part.data.chunks)
                  if (extractRawProtobufField(rawHeader, MEDIA_CONTENT_LENGTH_FIELD_NUMBER, 0) !== undefined) {
                    expectedMediaLength = Number(mediaHeader.contentLength)
                  }
                }
              }
            }

            break
          }
          case UMPPartId.MEDIA: {
            const [headerId, dataOffset] = new UmpReader(part.data).readVarInt(0)
            if (mediaHeaderId === headerId) {
              const chunks = part.data.split(dataOffset).remainingBuffer.chunks
              responseDataChunks.push(...chunks)
              for (const chunk of chunks) receivedMediaLength += chunk.byteLength
            }
            break
          }
          case UMPPartId.MEDIA_END: {
            const [headerId] = new UmpReader(part.data).readVarInt(0)
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
            const nextRequestPolicy = decodePart(part, NextRequestPolicy)
            if (!nextRequestPolicy) break

            shouldRetry = true
            shouldRetryDueToNextRequestPolicy = true

            // Audio and video loaders can reach this policy at different times.
            // Count from receipt so each loader waits only the remaining time,
            // and later segments do not repeat a delay that already elapsed.
            nextRequestBackoffTimeMs = nextRequestPolicy.backoffTimeMs || 0
            nextRequestBackoffUntilMs = Date.now() + nextRequestBackoffTimeMs

            const rawPolicy = part.data.chunks.length === 1
              ? part.data.chunks[0]
              : concatenateChunks(part.data.chunks)
            nextRequestPlaybackCookieBytes = extractRawProtobufField(
              rawPolicy,
              PLAYBACK_COOKIE_FIELD_NUMBER
            )
            break
          }
          case UMPPartId.FORMAT_INITIALIZATION_METADATA: {
            break
          }
          case UMPPartId.SABR_CONTEXT_UPDATE: {
            const sabrContextUpdate = decodePart(part, SabrContextUpdate)
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
            const sabrContextSendingPolicy = decodePart(part, SabrContextSendingPolicy)
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
            const reloadPlaybackContext = decodePart(part, ReloadPlaybackContext)
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
      })

      if (!currentState.abortStatus.finished) {
        chunkedDataBuffer = remainingData

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

  if (responseDataChunks.length > 0 && segmentComplete) {
    if (!operationInputs.isInit) {
      currentState.sabrStreamState.deliveredMediaFor.add(operationInputs.streamKind)
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
  } else if (shouldRetry || contextUpdateNeedsRetry) {
    // Context-only handshakes must echo the supplied context, with the same
    // retry limit as policy responses so neither can loop indefinitely.
    currentState.cumulativeRetries++
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
      body = VideoPlaybackAbrRequest.encode(currentState.abrRequest).finish()
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

    const isInit = url.searchParams.has('init')
    const formatIdString = url.searchParams.get('formatId')

    const variantTracks = player.getVariantTracks()
    const activeVariant = variantTracks.find(track => track.active)

    const streamIsAudio = url.pathname === 'audio'
    const streamIsVideo = url.pathname === 'video'

    let audioFormatId
    let videoFormatId

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
    }

    /** @type {import('googlevideo/protos').BufferedRange[]} */
    const bufferedRanges = []

    if (!isInit && activeVariant) {
      /** @__NOINLINE__ */ fillBufferedRanges(player, getManifest(), isAudioOnly, streamIsVideo, streamIsAudio, bufferedRanges, activeVariant)
    }

    const drcEnabled = url.searchParams.has('drc') || !!(activeVariant && activeVariant.audioRoles.includes('drc'))
    const enableVoiceBoost = url.searchParams.has('vb') || !!(activeVariant && activeVariant.audioRoles.includes('vb'))

    return {
      audioFormatId,
      videoFormatId,
      bufferedRanges,
      drcEnabled,
      enableVoiceBoost,
      bandwidthEstimate: player.getStats().estimatedBandwidth,
      playbackRate: player.getPlaybackRate(),
      width: playerWidth.value,
      height: playerHeight.value,
      getBufferedAheadSeconds: () => getBufferedAheadSeconds(player),
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
    const resolution = streamIsVideo ? parseInt(url.searchParams.get('resolution')) : undefined
    const playerTimeMs = url.searchParams.get('startTimeMs') ?? '0'
    const { audioFormatId, videoFormatId, bufferedRanges, drcEnabled, enableVoiceBoost } = context

    const { sabrContexts, unsentSabrContexts } = prepareSabrContexts(sabrStreamState)

    /** @type {VideoPlaybackAbrRequest} */
    const requestData = {
      clientAbrState: {
        bandwidthEstimate: String(Math.round(context.bandwidthEstimate)),
        timeSinceLastManualFormatSelectionMs: streamIsVideo ? '0' : undefined,
        stickyResolution: resolution,
        lastManualSelectedResolution: resolution,
        playbackRate: context.playbackRate,
        enabledTrackTypesBitfield: streamIsAudio ? 1 : 0,
        drcEnabled,
        enableVoiceBoost,
        playerTimeMs,
        clientViewportWidth: context.width,
        clientViewportHeight: context.height,
        clientViewportIsFlexible: false
      },
      preferredAudioFormatIds: [audioFormatId],
      preferredVideoFormatIds: [videoFormatId],
      preferredSubtitleFormatIds: [],
      selectedFormatIds: isInit ? [] : [audioFormatId, videoFormatId],
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
      body = VideoPlaybackAbrRequest.encode(requestData).finish()
    } catch (error) {
      console.error('Invalid VideoPlaybackAbrRequest data', requestData)
      throw error
    }

    const sequenceNumber = parseInt(url.searchParams.get('sq'))

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
      sequenceNumber,
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
    cleanup,
  }
}
