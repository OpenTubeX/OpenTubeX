import shaka from 'shaka-player'
import { parseWebmSegmentIndex } from './WebmSegmentIndexParser'
import { parseMp4SegmentIndex } from './Mp4SegmentIndexParser'
import { decodeSabrLiveHead, onSabrLiveHead } from './sabrProtocol'
import { getSabrFormatId } from './formatIds'

/**
 * @typedef {{
 *   scheme: string,
 *   duration: number,
 *   live?: { targetDurationSec: number },
 *   formats: {
 *     itag: number,
 *     lastModified: string,
 *     mimeType: string,
 *     xtags: string | undefined,
 *     bitrate: number,
 *     initRange: {
 *       start: number,
 *       end: number
 *     },
 *     indexRange: {
 *       start: number,
 *       end: number
 *     },
 *     width: number | undefined,
 *     height: number | undefined,
 *     frameRate: number | undefined,
 *     quality: string,
 *     language: string | undefined,
 *     audioSampleRate: number | undefined,
 *     audioChannels: number | undefined,
 *     isDrc: boolean | undefined,
 *     isVoiceBoost: boolean | undefined,
 *     isOriginal: boolean | undefined,
 *     isDubbed: boolean | undefined,
 *     isAutoDubbed: boolean | undefined,
 *     isDescriptive: boolean | undefined,
 *     isSecondary: boolean | undefined,
 *     spatialAudio: boolean
 *     label: string | undefined,
 *     colorTransferCharacteristics: 'BT709' | 'BT2020_10' | 'SMPTEST2084' | 'ARIB_STD_B67' | undefined,
 *     colorPrimaries: 'BT709' | 'BT2020' | undefined
 *   }[],
 *   captions: {
 *     id: string,
 *     label: string,
 *     mimeType: string,
 *     language: string,
 *     url: string
 *   }[],
 *   storyboards: {
 *     templateUrl: string,
 *     mimeType: string,
 *     columns: number,
 *     rows: number,
 *     thumbnailCount: number,
 *     thumbnailWidth: number,
 *     thumbnailHeight: number,
 *     storyboardCount: number,
 *     interval: number
 *   }[],
 *   chapters: {
 *     title: string,
 *     startSeconds: number,
 *     endSeconds: number,
 *     thumbnail?: {
 *       url: string,
 *       width: number,
 *       height: number
 *     }
 *   }[]
 * }} SabrManifest
 */

const NetworkingEngine = shaka.net.NetworkingEngine

export const MANIFEST_TYPE_SABR = 'application/sabr+json'

const CODECS_REGEX = /codecs="?([^"]+)"?/

const VIDEO_CODEC_PRIORITIES = [
  'av01',
  'vp09',
  'vp9',
  'avc1'
]

const LIVE_UPDATE_INTERVAL_MS = 1000
/** How many segments past the last reported head to expect before a new report */
const MAX_PREDICTED_LIVE_SEGMENTS = 3

/**
 * @implements {shaka.extern.ManifestParser}
 */
class SabrManifestParser {
  constructor() {
    /**
     * @private
     * @type {shaka.extern.ManifestConfiguration | null}
     */
    this._config = null

    /**
     * @private
     * @type {SabrLiveWindow | null}
     */
    this._liveWindow = null
  }

  /**
   * @param {string} _uri
   */
  banLocation(_uri) {
  }

  /**
   * @param {shaka.extern.ManifestConfiguration} config
   * @param {(() => boolean) | undefined} _isPreloadFn
   */
  configure(config, _isPreloadFn) {
    this._config = config
  }

  /**
   * @param {shaka.extern.Variant} _variant
   */
  onInitialVariantChosen(_variant) {
  }

  /**
   * @param {HTMLMediaElement | null} _mediaElement
   */
  setMediaElement(_mediaElement) {
  }

  /**
   * @param {string} uri
   * @param {shaka.extern.ManifestParser.PlayerInterface} playerInterface
   * @returns {Promise<shaka.extern.Manifest>}
   */
  async start(uri, { filter, networkingEngine }) {
    // As SABR manifests are a FreeTube internal thing we can skip going through the networking engine
    // because we know it will always have the same format

    // "data:" (5) + mime type length + "," (1)
    const uriPrefixLength = 5 + MANIFEST_TYPE_SABR.length + 1

    /** @type {SabrManifest} */
    const manifestData = JSON.parse(decodeURIComponent(uri.slice(uriPrefixLength)))

    const worstVideoFormat = manifestData.formats.reduce((previousFormat, currentFormat) => {
      if (currentFormat.width === undefined) {
        return previousFormat
      } else if (previousFormat === null) {
        return currentFormat
      } else {
        return currentFormat.bitrate < previousFormat.bitrate ? currentFormat : previousFormat
      }
    }, null)

    /** @type {shaka.media.PresentationTimeline} */
    let presentationTimeline

    if (manifestData.live) {
      const audioFormat = manifestData.formats.find(format => format.mimeType.startsWith('audio/'))
      const head = await requestLiveHead(manifestData.scheme, audioFormat, worstVideoFormat, networkingEngine)

      // The player unloaded while waiting for the head
      if (this._config === null) {
        throw new shaka.util.Error(
          shaka.util.Error.Severity.CRITICAL,
          shaka.util.Error.Category.PLAYER,
          shaka.util.Error.Code.OPERATION_ABORTED
        )
      }

      this._liveWindow = new SabrLiveWindow(head, manifestData.live.targetDurationSec)
      presentationTimeline = this._liveWindow.presentationTimeline
      this._liveWindow.start(manifestData.scheme, () =>
        requestLiveHead(manifestData.scheme, audioFormat, worstVideoFormat, networkingEngine))
    } else {
      presentationTimeline = new shaka.media.PresentationTimeline(0, 0, true)
      presentationTimeline.setStatic(true)
      presentationTimeline.setSegmentAvailabilityDuration(Infinity)
      presentationTimeline.lockStartTime()
      presentationTimeline.setDuration(manifestData.duration)
    }

    const liveWindow = this._liveWindow

    let currentId = 0

    /** @type {shaka.extern.Stream[]} */
    const audioStreams = []
    /** @type {shaka.extern.Stream[]} */
    const videoStreams = []

    const hasDrcAudio = manifestData.formats.some(format => format.isDrc)
    const hasVoiceBoostAudio = manifestData.formats.some(format => format.isVoiceBoost)

    // For audio only playback we still need to specify a video fromat ID
    // the server won't return it but it will error if we don't list one
    // so lets pick the worst video quality  just in case
    let fakeVideoFormatId

    if (this._config.disableVideo) {
      fakeVideoFormatId = getSabrFormatId(worstVideoFormat)
    }

    for (const format of manifestData.formats) {
      if (format.mimeType.startsWith('audio/')) {
        if (format.xtags === 'CgcKAnZiEgEx') {
          // Workaround to reject certain xtags value to avoid reload
          // https://github.com/LuanRT/googlevideo/issues/42
          // console.log('CgcKAnZiEgEx audio format', format)
          continue
        }
        audioStreams.push(
          /** @__NOINLINE__ */ createAudioStream(
            format,
            currentId++,
            hasDrcAudio,
            hasVoiceBoostAudio,
            presentationTimeline,
            networkingEngine,
            fakeVideoFormatId,
            manifestData.scheme,
            liveWindow
          )
        )
      } else if (!this._config.disableVideo) {
        videoStreams.push(
          /** @__NOINLINE__ */ createVideoStream(
            format,
            currentId++,
            presentationTimeline,
            networkingEngine,
            manifestData.scheme,
            liveWindow
          )
        )
      }
    }

    audioStreams.sort((a, b) => b.bandwidth - a.bandwidth)

    if (!this._config.disableVideo) {
      videoStreams.sort((a, b) => {
        return VIDEO_CODEC_PRIORITIES.findIndex(codec => a.codecs.startsWith(codec)) -
          VIDEO_CODEC_PRIORITIES.findIndex(codec => b.codecs.startsWith(codec))
      })
    }

    /** @type {shaka.extern.Variant[]} */
    const variants = []
    let variantId = 0

    if (this._config.disableVideo) {
      for (const stream of audioStreams) {
        variants.push({
          id: variantId++,
          audio: stream,
          bandwidth: stream.bandwidth,
          language: stream.language,
          allowedByApplication: true,
          allowedByKeySystem: true,
          decodingInfos: [],
          disabledUntilTime: 0,
          primary: stream.primary,
          video: null
        })
      }
    } else {
      for (const audioStream of audioStreams) {
        for (const videoStream of videoStreams) {
          variants.push({
            id: variantId++,
            audio: audioStream,
            video: videoStream,
            bandwidth: audioStream.bandwidth + videoStream.bandwidth,
            language: audioStream.language,
            allowedByApplication: true,
            allowedByKeySystem: true,
            decodingInfos: [],
            disabledUntilTime: 0,
            primary: audioStream.primary
          })
        }
      }
    }

    const textStreams = /** @__NOINLINE__ */ createTextStreams(manifestData.captions, presentationTimeline, currentId)
    currentId += textStreams.length

    const imageStreams = /** @__NOINLINE__ */ createImageStreams(manifestData.storyboards, presentationTimeline, currentId)

    /** @type {shaka.extern.Manifest} */
    const manifest = {
      type: 'SABR',
      // Live playback starts at the live edge
      startTime: liveWindow ? null : 0,
      variants,
      textStreams,
      imageStreams,
      chapterStreams: [],
      presentationTimeline,

      gapCount: 0,
      ignoreManifestTimestampsInSegmentsMode: false,
      isLowLatency: false,
      nextUrl: null,
      offlineSessionIds: [],
      periodCount: 1,
      sequenceMode: false,
      serviceDescription: null,
    }

    await filter(manifest)

    return manifest
  }

  /**
   * @returns {Promise<void>}
   */
  stop() {
    this._config = null
    this._liveWindow?.stop()
    this._liveWindow = null
    return Promise.resolve()
  }
}

/**
 * @param {SabrManifest['formats'][0]} format
 * @param {number} id
 * @param {boolean} hasDrcAudio
 * @param {boolean} hasVoiceBoostAudio
 * @param {shaka.media.PresentationTimeline} presentationTimeline
 * @param {shaka.net.NetworkingEngine} networkingEngine
 * @param {string | undefined} fakeVideoFormatId
 * @param {string} scheme
 * @param {SabrLiveWindow | null} liveWindow
 */
function createAudioStream(
  format,
  id,
  hasDrcAudio,
  hasVoiceBoostAudio,
  presentationTimeline,
  networkingEngine,
  fakeVideoFormatId,
  scheme,
  liveWindow
) {
  const roles = []

  if (format.isDrc) {
    roles.push('drc')
  } else if (format.isVoiceBoost) {
    roles.push('voice-boost')
  } else if (format.isDubbed) {
    roles.push('dubbed')
  } else if (format.isAutoDubbed) {
    roles.push('dubbed-auto')
  } else if (format.isDescriptive) {
    roles.push('descriptive')
  } else if (format.isSecondary) {
    roles.push('secondary')
  } else if (format.isOriginal) {
    roles.push('main')
  }

  let label = null

  if (format.label) {
    if (format.isDrc) {
      label = `${format.label} (Stable Volume)`
    } else if (format.isVoiceBoost) {
      label = `${format.label} (Voice Boost)`
    } else {
      label = format.label
    }
  } else if (hasDrcAudio || hasVoiceBoostAudio) {
    if (format.isDrc) {
      label = 'Stable Volume'
    } else if (format.isVoiceBoost) {
      label = 'Voice Boost'
    } else {
      label = 'Original'
    }
  }

  /** @type {shaka.extern.Stream} */
  const stream = {
    type: 'audio',
    id,
    originalId: getSabrFormatId(format),
    mimeType: format.mimeType.split(';', 1)[0],
    codecs: format.mimeType.match(CODECS_REGEX)[1],
    fullMimeTypes: new Set([format.mimeType]),
    bandwidth: format.bitrate,
    audioSamplingRate: format.audioSampleRate ?? null,
    channelsCount: format.audioChannels ?? null,
    label,
    language: format.language ?? 'und',
    originalLanguage: format.language ?? null,
    spatialAudio: format.spatialAudio,
    roles,
    primary: roles.includes('main'),
    segmentIndex: null,
    createSegmentIndex: async () => {
      // shaka-player sometimes calls the create function even when the segment index already exists
      if (stream.segmentIndex) { return }

      if (liveWindow) {
        liveWindow.openSegmentIndex(stream, buildSegmentUrl(format, stream, scheme, fakeVideoFormatId))
        return
      }

      stream.segmentIndex = await createMediaSegmentIndex(
        format,
        stream,
        presentationTimeline,
        networkingEngine,
        scheme,
        fakeVideoFormatId
      )
    },
    closeSegmentIndex: () => {
      liveWindow?.closeSegmentIndex(stream)
      if (stream.segmentIndex) {
        stream.segmentIndex.release()
        stream.segmentIndex = null
      }
    },

    accessibilityPurpose: null,
    closedCaptions: null,
    drmInfos: [],
    emsgSchemeIdUris: null,
    encrypted: false,
    external: false,
    fastSwitching: false,
    forced: false,
    groupId: null,
    isAudioMuxedInVideo: false,
    keyIds: new Set(),
    trickModeVideo: null
  }

  return stream
}

/**
 * @param {SabrManifest['formats'][0]} format
 * @param {number} id
 * @param {shaka.media.PresentationTimeline} presentationTimeline
 * @param {shaka.net.NetworkingEngine} networkingEngine
 * @param {string} scheme
 * @param {SabrLiveWindow | null} liveWindow
 */
function createVideoStream(format, id, presentationTimeline, networkingEngine, scheme, liveWindow) {
  const colorGamut = format.colorPrimaries === 'BT2020' ? 'rec2020' : 'srgb'

  let hdr = 'SDR'

  if (format.colorTransferCharacteristics === 'SMPTEST2084') {
    hdr = 'PQ'
  } else if (format.colorTransferCharacteristics === 'ARIB_STD_B67') {
    hdr = 'HLG'
  }

  /** @type {shaka.extern.Stream} */
  const stream = {
    type: 'video',
    id,
    originalId: getSabrFormatId(format),
    mimeType: format.mimeType.split(';', 1)[0],
    codecs: format.mimeType.match(CODECS_REGEX)[1],
    fullMimeTypes: new Set([format.mimeType]),
    bandwidth: format.bitrate,
    width: format.width,
    height: format.height,
    frameRate: format.frameRate,
    colorGamut,
    hdr,
    roles: [],
    segmentIndex: null,
    createSegmentIndex: async () => {
      // shaka-player sometimes calls the create function even when the segment index already exists
      if (stream.segmentIndex) { return }

      if (liveWindow) {
        liveWindow.openSegmentIndex(stream, buildSegmentUrl(format, stream, scheme))
        return
      }

      stream.segmentIndex = await createMediaSegmentIndex(format, stream, presentationTimeline, networkingEngine, scheme)
    },
    closeSegmentIndex: () => {
      liveWindow?.closeSegmentIndex(stream)
      if (stream.segmentIndex) {
        stream.segmentIndex.release()
        stream.segmentIndex = null
      }
    },

    accessibilityPurpose: null,
    audioSamplingRate: null,
    channelsCount: null,
    closedCaptions: null,
    drmInfos: [],
    emsgSchemeIdUris: null,
    encrypted: false,
    external: false,
    fastSwitching: false,
    forced: false,
    groupId: null,
    isAudioMuxedInVideo: false,
    keyIds: new Set(),
    label: null,
    language: 'und',
    originalLanguage: null,
    primary: false,
    spatialAudio: false,
    trickModeVideo: null
  }

  return stream
}

/**
 * @param {SabrManifest['captions']} captions
 * @param {shaka.media.PresentationTimeline} presentationTimeline
 * @param {number} currentId
 */
function createTextStreams(captions, presentationTimeline, currentId) {
  return captions.map((caption) => {
    /** @type {shaka.extern.Stream} */
    const stream = {
      type: 'text',
      id: currentId++,
      originalId: caption.id,
      mimeType: caption.mimeType,
      fullMimeTypes: new Set([caption.mimeType]),
      label: caption.label,
      language: caption.language,
      originalLanguage: caption.language,
      kind: 'captions',
      segmentIndex: null,
      createSegmentIndex: () => {
        stream.segmentIndex = shaka.media.SegmentIndex.forSingleSegment(
          0,
          presentationTimeline.getDuration(),
          [caption.url]
        )

        stream.segmentIndex.get(0).mimeType = caption.mimeType

        return Promise.resolve()
      },
      closeSegmentIndex: () => {
        if (stream.segmentIndex) {
          stream.segmentIndex.release()
          stream.segmentIndex = null
        }
      },

      accessibilityPurpose: null,
      audioSamplingRate: null,
      channelsCount: null,
      closedCaptions: null,
      codecs: '',
      drmInfos: [],
      emsgSchemeIdUris: null,
      encrypted: false,
      external: false,
      fastSwitching: false,
      forced: false,
      groupId: null,
      isAudioMuxedInVideo: false,
      keyIds: new Set(),
      primary: false,
      roles: [],
      spatialAudio: false,
      trickModeVideo: null
    }

    return stream
  })
}

/**
 * @param {SabrManifest['storyboards']} storyboards
 * @param {shaka.media.PresentationTimeline} presentationTimeline
 * @param {number} currentId
 */
function createImageStreams(storyboards, presentationTimeline, currentId) {
  return storyboards.map((storyboard) => {
    const tilesLayout = `${storyboard.columns}x${storyboard.rows}`

    /** @type {shaka.extern.Stream} */
    const stream = {
      type: 'image',
      id: currentId++,
      mimeType: storyboard.mimeType,
      fullMimeTypes: new Set([storyboard.mimeType]),
      tilesLayout,
      width: storyboard.thumbnailWidth * storyboard.columns,
      height: storyboard.thumbnailHeight * storyboard.rows,
      segmentIndex: null,
      createSegmentIndex: () => {
        const duration = presentationTimeline.getDuration()

        const interval = storyboard.interval > 0 ? storyboard.interval : duration / storyboard.thumbnailCount
        const segmentDuration = interval * storyboard.columns * storyboard.rows

        const references = []

        for (let i = 0; i < storyboard.storyboardCount; i++) {
          const startTime = i * segmentDuration
          const endTime = Math.min(startTime + segmentDuration, duration)

          const urls = [storyboard.templateUrl.replace('$M', i)]

          const segmentReference = new shaka.media.SegmentReference(
            startTime,
            endTime,
            () => urls,
            0,
            null,
            null,
            0,
            0,
            Infinity,
            undefined,
            tilesLayout,
            interval
          )

          segmentReference.mimeType = storyboard.mimeType

          references.push(segmentReference)
        }

        stream.segmentIndex = new shaka.media.SegmentIndex(references)

        return Promise.resolve()
      },
      closeSegmentIndex: () => {
        if (stream.segmentIndex) {
          stream.segmentIndex.release()
          stream.segmentIndex = null
        }
      },

      accessibilityPurpose: null,
      audioSamplingRate: null,
      channelsCount: null,
      closedCaptions: null,
      codecs: '',
      drmInfos: [],
      emsgSchemeIdUris: null,
      encrypted: false,
      external: false,
      fastSwitching: false,
      forced: false,
      groupId: null,
      isAudioMuxedInVideo: false,
      keyIds: new Set(),
      label: null,
      language: 'und',
      originalId: null,
      originalLanguage: null,
      primary: false,
      roles: [],
      spatialAudio: false,
      trickModeVideo: null
    }

    return stream
  })
}

/**
 * @param {SabrManifest['formats'][0]} format
 * @param {shaka.extern.Stream} stream
 * @param {string} scheme
 * @param {string | undefined} fakeVideoFormatId
 */
function buildSegmentUrl(format, stream, scheme, fakeVideoFormatId = undefined) {
  let url = `${scheme}:${stream.type}?formatId=${encodeURIComponent(stream.originalId)}`

  if (fakeVideoFormatId) {
    url += `&videoFormatId=${encodeURIComponent(fakeVideoFormatId)}`
  }

  if (format.isDrc) {
    url += '&drc'
  } else if (format.isVoiceBoost) {
    url += '&vb'
  }

  if (stream.type === 'video') {
    const resolution = format.height || 360

    url += `&resolution=${resolution}`
  }

  return url
}

/**
 * @param {SabrManifest['formats'][0]} format
 * @param {shaka.extern.Stream} stream
 * @param {shaka.media.PresentationTimeline} presentationTimeline
 * @param {shaka.net.NetworkingEngine} networkingEngine
 * @param {string} scheme
 * @param {string | undefined} fakeVideoFormatId
 */
async function createMediaSegmentIndex(
  format,
  stream,
  presentationTimeline,
  networkingEngine,
  scheme,
  fakeVideoFormatId = undefined
) {
  const url = buildSegmentUrl(format, stream, scheme, fakeVideoFormatId)

  /** @type {shaka.extern.Request} */
  const request = {
    method: 'GET',
    uris: [`${url}&init`],
    contentType: stream.type,
    body: null,
    headers: {},
    allowCrossSiteCredentials: false,
    retryParameters: NetworkingEngine.defaultRetryParameters(),
    licenseRequestType: null,
    sessionId: null,
    drmInfo: null,
    initData: null,
    initDataType: null,
    streamDataCallback: null,
  }

  /** @type {shaka.extern.Response} */
  const response = await networkingEngine.request(
    NetworkingEngine.RequestType.SEGMENT,
    request,
    {
      stream: stream,
      type: NetworkingEngine.AdvancedRequestType.INIT_SEGMENT
    }
  ).promise

  return /** @__NOINLINE__ */ createVodMediaSegmentIndex(url, response, format, stream, presentationTimeline.getDuration())
}

/**
 * @param {string} url
 * @param {shaka.extern.Response} response
 * @param {SabrManifest['formats'][0]} format
 * @param {shaka.extern.Stream} stream
 * @param {number} duration
 */
function createVodMediaSegmentIndex(url, response, format, stream, duration) {
  /** @type {shaka.extern.MediaQualityInfo} */
  const mediaQuality = {
    contentType: stream.type,
    bandwidth: stream.bandwidth,
    mimeType: stream.mimeType,
    codecs: stream.codecs,
    language: stream.language,
    label: stream.label,
    audioSamplingRate: stream.audioSamplingRate,
    channelsCount: stream.channelsCount,
    width: stream.width ?? null,
    height: stream.height ?? null,
    frameRate: stream.frameRate ?? null,
    roles: stream.roles,
    pixelAspectRatio: stream.pixelAspectRatio ?? null
  }

  const buffer = ArrayBuffer.isView(response.data) ? response.data.buffer : response.data

  const initData = buffer.slice(format.initRange.start, format.initRange.end + 1)
  const indexData = buffer.slice(format.indexRange.start, format.indexRange.end + 1)

  const initUrls = [`${url}&init`]

  const initSegmentReference = new shaka.media.InitSegmentReference(
    () => initUrls,
    format.initRange.start,
    format.initRange.end,
    mediaQuality,
    null,
    initData,
    null
  )

  initSegmentReference.mimeType = stream.mimeType
  initSegmentReference.codecs = stream.codecs

  /** @type {shaka.media.SegmentReference[] | undefined} */
  let references

  if (stream.mimeType.endsWith('/webm')) {
    references = /** @__NOINLINE__ */ parseWebmSegmentIndex(indexData, initData, url, initSegmentReference, 0, 0, duration)
  } else {
    references = /** @__NOINLINE__ */ parseMp4SegmentIndex(indexData, format.indexRange.start, url, initSegmentReference, 0, 0, duration)
  }

  for (const reference of references) {
    reference.mimeType = stream.mimeType
    reference.codecs = stream.codecs
  }

  return new shaka.media.SegmentIndex(references)
}

/**
 * @param {string} scheme
 * @param {SabrManifest['formats'][0]} audioFormat
 * @param {SabrManifest['formats'][0]} videoFormat
 * @param {shaka.net.NetworkingEngine} networkingEngine
 */
async function requestLiveHead(scheme, audioFormat, videoFormat, networkingEngine) {
  const uri = `${scheme}:live?formatId=${encodeURIComponent(getSabrFormatId(audioFormat))}` +
    `&videoFormatId=${encodeURIComponent(getSabrFormatId(videoFormat))}`

  const response = await networkingEngine.request(
    NetworkingEngine.RequestType.SEGMENT,
    NetworkingEngine.makeRequest([uri], NetworkingEngine.defaultRetryParameters()),
    { type: NetworkingEngine.AdvancedRequestType.MEDIA_SEGMENT }
  ).promise

  return decodeSabrLiveHead(response.data)
}

/**
 * @typedef LiveSegment
 * @property {number} sequenceNumber
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} requestTimeMs
 */

/**
 * Lists the segments of a live SABR stream, which YouTube numbers by `sq`.
 * Each lasts the target duration, so their times follow from the head the
 * server reports. Shaka places media by its own timestamps, so the estimate's
 * small drift from them does not misplace it.
 */
class SabrLiveWindow {
  /**
   * @param {import('./sabrProtocol').SabrLiveHead} head
   * @param {number} targetDuration in seconds
   */
  constructor(head, targetDuration) {
    /** @private */
    this._targetDuration = targetDuration
    /** @private */
    this._head = head
    /**
     * @private
     * @type {LiveSegment[]}
     */
    this._segments = []
    /**
     * Streams with an open segment index, and their segment URL
     * @private
     * @type {Map<shaka.extern.Stream, string>}
     */
    this._streams = new Map()
    /** @private */
    this._intervalId = null
    /**
     * @private
     * @type {(() => void) | null}
     */
    this._removeHeadListener = null
    /**
     * @private
     * @type {() => Promise<unknown>}
     */
    this._refreshHead = async () => {}
    /** @private */
    this._headRefreshedAtMs = 0

    const seekableSegments = Math.floor((head.timeMs - head.minSeekableTimeMs) / 1000 / targetDuration)
    this._appendSegments(Math.max(1, head.sequenceNumber - seekableSegments), head.sequenceNumber)

    // Start where YouTube's player does: at the maximum seekable time, a few
    // segments behind the head, so the next segments are already available.
    const end = this._segments.at(-1).endTime
    const delay = Math.max(end - head.maxSeekableTimeMs / 1000, 3 * targetDuration)

    this.presentationTimeline = new shaka.media.PresentationTimeline(0, delay)
    this.presentationTimeline.setStatic(false)
    // The server only reports segments that exist, so the edge must not run ahead of them
    this.presentationTimeline.setClampLiveEdgeToSegments(true)
    this.presentationTimeline.notifyMaxSegmentDuration(targetDuration)
    this.presentationTimeline.notifySegments(this._segments)
    this._updateAvailabilityDuration()
  }

  /**
   * @param {string} scheme
   * @param {() => Promise<unknown>} refreshHead requests the head, which reaches the head listener
   */
  start(scheme, refreshHead) {
    this._refreshHead = refreshHead
    this._removeHeadListener = onSabrLiveHead(scheme, (head) => {
      // Audio and video requests can report heads out of order
      if (head.sequenceNumber < this._head.sequenceNumber) return

      this._head = head
      this._update()
    })

    // A paused player makes no requests, so follow the clock between head reports
    this._intervalId = setInterval(() => this._update(), LIVE_UPDATE_INTERVAL_MS)
  }

  stop() {
    clearInterval(this._intervalId)
    this._intervalId = null
    this._removeHeadListener?.()
    this._removeHeadListener = null
    this._streams.clear()
  }

  /**
   * @param {shaka.extern.Stream} stream
   * @param {string} url
   */
  openSegmentIndex(stream, url) {
    this._streams.set(stream, url)
    stream.segmentIndex = new shaka.media.SegmentIndex(
      this._segments.map(segment => this._createReference(stream, url, segment))
    )
  }

  /**
   * @param {shaka.extern.Stream} stream
   */
  closeSegmentIndex(stream) {
    this._streams.delete(stream)
  }

  /** @private */
  _update() {
    const head = this._head
    const targetDurationMs = this._targetDuration * 1000

    // Segments past the head become available every target duration. Expect
    // them for a while; a stream that stops producing them reports no new head.
    const elapsedSegments = Math.max(0, Math.floor((Date.now() - head.receivedAtMs) / targetDurationMs))
    const lastSequenceNumber = head.sequenceNumber + Math.min(elapsedSegments, MAX_PREDICTED_LIVE_SEGMENTS)

    // Without media requests, such as while paused, nothing reports the head.
    // Ask for it once the predictions run out, so the edge stays current.
    if (elapsedSegments > MAX_PREDICTED_LIVE_SEGMENTS && Date.now() - this._headRefreshedAtMs >= targetDurationMs) {
      this._headRefreshedAtMs = Date.now()
      this._refreshHead().catch(() => {})
    }

    const previousLast = this._segments.at(-1).sequenceNumber
    const added = this._appendSegments(previousLast + 1, lastSequenceNumber)
    this.presentationTimeline.notifySegments(added)
    this._updateAvailabilityDuration()

    // A newer head can also move the start of the window
    const windowStart = this.presentationTimeline.getSegmentAvailabilityStart()

    for (const [stream, url] of this._streams) {
      stream.segmentIndex?.mergeAndEvict(added.map(segment => this._createReference(stream, url, segment)), windowStart)
    }

    const firstAvailable = this._segments.findIndex(segment => segment.endTime > windowStart)
    if (firstAvailable > 0) this._segments.splice(0, firstAvailable)
  }

  /**
   * @private
   * @param {number} first
   * @param {number} last
   */
  _appendSegments(first, last) {
    const head = this._head
    const added = []

    for (let sequenceNumber = first; sequenceNumber <= last; sequenceNumber++) {
      const estimatedStart = head.timeMs / 1000 + (sequenceNumber - head.sequenceNumber) * this._targetDuration
      const previous = this._segments.at(-1)

      // Follow the newest head's estimate, so the times cannot drift from the
      // media timestamps when segments differ from the target duration. The
      // buffered ranges reported to SABR map media times to these segments.
      // Segments must not overlap, so a segment starts no earlier than the
      // previous one ends, and ends early to make up for it.
      const startTime = previous ? Math.max(previous.endTime, estimatedStart) : estimatedStart
      const estimatedEnd = estimatedStart + this._targetDuration
      const endTime = estimatedEnd > startTime ? estimatedEnd : startTime + this._targetDuration

      // SABR returns the segment containing the requested time, so ask for its middle
      const requestTimeMs = Math.round((estimatedStart + this._targetDuration / 2) * 1000)
      const segment = { sequenceNumber, startTime, endTime, requestTimeMs }
      this._segments.push(segment)
      added.push(segment)
    }

    return added
  }

  /** @private */
  _updateAvailabilityDuration() {
    const end = this._segments.at(-1).endTime
    this.presentationTimeline.setSegmentAvailabilityDuration(
      Math.max(end - this._head.minSeekableTimeMs / 1000, this._targetDuration)
    )
  }

  /**
   * @private
   * @param {shaka.extern.Stream} stream
   * @param {string} url
   * @param {LiveSegment} segment
   */
  _createReference(stream, url, segment) {
    const uris = [`${url}&startTimeMs=${segment.requestTimeMs}&sq=${segment.sequenceNumber}`]

    // Live segments are self-initializing, so they have no init segment
    const reference = new shaka.media.SegmentReference(
      segment.startTime,
      segment.endTime,
      () => uris,
      0,
      null,
      null,
      0,
      0,
      Infinity
    )

    reference.mimeType = stream.mimeType
    reference.codecs = stream.codecs

    return reference
  }
}

if (process.env.SUPPORTS_LOCAL_API) {
  shaka.media.ManifestParser.registerParserByMime(MANIFEST_TYPE_SABR, () => new SabrManifestParser())
}
