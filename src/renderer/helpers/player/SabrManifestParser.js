import shaka from 'shaka-player'
import { parseWebmSegmentIndex } from './WebmSegmentIndexParser'
import { parseMp4SegmentIndex } from './Mp4SegmentIndexParser'

/**
 * @typedef {{
 *   scheme: string,
 *   duration: number,
 *   isLive?: boolean,
 *   presentationStartTime?: number,
 *   presentationDelay?: number,
 *   segmentDuration?: number,
 *   segmentAvailabilityDuration?: number,
 *   formats: {
 *     itag: number,
 *     lastModified: string,
 *     mimeType: string,
 *     xtags: string | undefined,
 *     bitrate: number,
 *     initRange?: {
 *       start: number,
 *       end: number
 *     },
 *     indexRange?: {
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
    const isLive = manifestData.isLive === true
    const presentationStartTime = isLive ? manifestData.presentationStartTime : 0
    const presentationDelay = isLive ? manifestData.presentationDelay ?? 0 : 0
    const presentationTimeline = new shaka.media.PresentationTimeline(
      presentationStartTime,
      presentationDelay,
      true,
      manifestData.segmentDuration ?? 1
    )

    presentationTimeline.setStatic(!isLive)
    presentationTimeline.setSegmentAvailabilityDuration(
      isLive ? manifestData.segmentAvailabilityDuration ?? Infinity : Infinity
    )
    presentationTimeline.lockStartTime()
    presentationTimeline.setDuration(isLive ? Infinity : manifestData.duration)

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
      const worstVideoFormat = manifestData.formats.reduce((previousFormat, currentFormat) => {
        if (currentFormat.width === undefined) {
          return previousFormat
        } else if (previousFormat === null) {
          return currentFormat
        } else {
          return currentFormat.bitrate < previousFormat.bitrate ? currentFormat : previousFormat
        }
      }, null)

      fakeVideoFormatId = buildFormatId(worstVideoFormat)
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
            manifestData.scheme
          )
        )
      } else if (!this._config.disableVideo) {
        videoStreams.push(
          /** @__NOINLINE__ */ createVideoStream(
            format,
            currentId++,
            presentationTimeline,
            networkingEngine,
            manifestData.scheme
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
      startTime: 0,
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
    return Promise.resolve()
  }
}

/**
 * @param {SabrManifest['formats'][0]} format
 */
function buildFormatId(format) {
  return `${format.itag}-${format.lastModified ?? ''}-${format.xtags ?? ''}`
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
 */
function createAudioStream(
  format,
  id,
  hasDrcAudio,
  hasVoiceBoostAudio,
  presentationTimeline,
  networkingEngine,
  fakeVideoFormatId,
  scheme
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
    originalId: buildFormatId(format),
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
 */
function createVideoStream(format, id, presentationTimeline, networkingEngine, scheme) {
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
    originalId: buildFormatId(format),
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

      stream.segmentIndex = await createMediaSegmentIndex(format, stream, presentationTimeline, networkingEngine, scheme)
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

  if (presentationTimeline.isLive()) {
    url += '&live'
  }

  const initUrl = presentationTimeline.isLive()
    ? `${url}&init&startTimeMs=0`
    : `${url}&init`

  /** @type {shaka.extern.Request} */
  const request = {
    method: 'GET',
    uris: [initUrl],
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

  const segmentIndex = presentationTimeline.isLive()
    ? /** @__NOINLINE__ */ createLiveMediaSegmentIndex(initUrl, url, response, stream, presentationTimeline)
    : /** @__NOINLINE__ */ createVodMediaSegmentIndex(
        url,
        response,
        format,
        stream,
        presentationTimeline.getDuration()
      )

  presentationTimeline.notifySegments([...segmentIndex])

  return segmentIndex
}

/**
 * Live SABR formats have no byte index. The server selects a segment from the
 * requested playback time, so expose the moving DVR window as timed references.
 *
 * @param {string} initUrl
 * @param {string} url
 * @param {shaka.extern.Response} response
 * @param {shaka.extern.Stream} stream
 * @param {shaka.media.PresentationTimeline} presentationTimeline
 */
function createLiveMediaSegmentIndex(initUrl, url, response, stream, presentationTimeline) {
  const segmentDuration = presentationTimeline.getMaxSegmentDuration()
  const mediaQuality = /** @__NOINLINE__ */ createMediaQualityInfo(stream)
  const liveMetadataHeader = response.headers['x-sabr-live-metadata']
  const liveMetadata = liveMetadataHeader ? JSON.parse(liveMetadataHeader) : null
  const headTime = Number(liveMetadata?.headTimeMs) / 1000
  const wallTime = Number(liveMetadata?.wallTimeMs) / 1000
  const minSeekableTime = Number(liveMetadata?.minSeekableTimeTicks) / Number(liveMetadata?.minSeekableTimescale)
  const maxSeekableTime = Number(liveMetadata?.maxSeekableTimeTicks) / Number(liveMetadata?.maxSeekableTimescale)

  if (Number.isFinite(headTime) && Number.isFinite(wallTime)) {
    presentationTimeline.setPresentationStartTime(wallTime - headTime)
  }
  if (Number.isFinite(minSeekableTime) && Number.isFinite(maxSeekableTime) && maxSeekableTime > minSeekableTime) {
    presentationTimeline.setSegmentAvailabilityDuration(maxSeekableTime - minSeekableTime)
  }
  const initializationMetadataHeader = response.headers['x-sabr-format-initialization']
  const initializationMetadata = initializationMetadataHeader
    ? JSON.parse(initializationMetadataHeader)
    : null
  const initRange = initializationMetadata?.initRange
  const responseBuffer = ArrayBuffer.isView(response.data)
    ? response.data.buffer.slice(response.data.byteOffset, response.data.byteOffset + response.data.byteLength)
    : response.data
  const initData = Number.isInteger(initRange?.start) && Number.isInteger(initRange?.end)
    ? responseBuffer.slice(initRange.start, initRange.end + 1)
    : responseBuffer

  if (initData.byteLength <= 4) {
    throw new Error('Live SABR response did not contain valid initialization data')
  }

  const initSegmentReference = new shaka.media.InitSegmentReference(
    () => [initUrl],
    initRange?.start ?? 0,
    initRange?.end ?? null,
    mediaQuality,
    null,
    initData,
    null
  )

  initSegmentReference.mimeType = stream.mimeType
  initSegmentReference.codecs = stream.codecs

  /** @param {number} segmentNumber */
  const createReference = (segmentNumber) => {
    const startTime = segmentNumber * segmentDuration
    const reference = new shaka.media.SegmentReference(
      startTime,
      startTime + segmentDuration,
      // SABR selects the segment ending at playerTimeMs, while Shaka asks for
      // the reference containing the playhead. Request the reference end so
      // the returned media timestamps cover [startTime, endTime].
      () => [`${url}&startTimeMs=${Math.round((startTime + segmentDuration) * 1000)}`],
      0,
      null,
      initSegmentReference,
      0,
      0,
      Infinity
    )

    reference.mimeType = stream.mimeType
    reference.codecs = stream.codecs
    return reference
  }

  const availabilityStart = presentationTimeline.getSegmentAvailabilityStart()
  const availabilityEnd = presentationTimeline.getSegmentAvailabilityEnd()
  const firstSegmentNumber = Math.max(0, Math.floor(availabilityStart / segmentDuration))
  let nextSegmentNumber = Math.max(firstSegmentNumber, Math.floor(availabilityEnd / segmentDuration))
  const references = []

  for (let segmentNumber = firstSegmentNumber; segmentNumber < nextSegmentNumber; segmentNumber++) {
    references.push(createReference(segmentNumber))
  }

  const segmentIndex = new shaka.media.SegmentIndex(references)
  segmentIndex.updateEvery(segmentDuration, () => {
    segmentIndex.evict(presentationTimeline.getSegmentAvailabilityStart())

    const endSegmentNumber = Math.floor(presentationTimeline.getSegmentAvailabilityEnd() / segmentDuration)
    const newReferences = []
    while (nextSegmentNumber < endSegmentNumber) {
      newReferences.push(createReference(nextSegmentNumber++))
    }
    return newReferences
  })

  return segmentIndex
}

/**
 * @param {shaka.extern.Stream} stream
 * @returns {shaka.extern.MediaQualityInfo}
 */
function createMediaQualityInfo(stream) {
  return {
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
}

/**
 * @param {string} url
 * @param {shaka.extern.Response} response
 * @param {SabrManifest['formats'][0]} format
 * @param {shaka.extern.Stream} stream
 * @param {number} duration
 */
function createVodMediaSegmentIndex(url, response, format, stream, duration) {
  const mediaQuality = /** @__NOINLINE__ */ createMediaQualityInfo(stream)

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

if (process.env.SUPPORTS_LOCAL_API) {
  shaka.media.ManifestParser.registerParserByMime(MANIFEST_TYPE_SABR, () => new SabrManifestParser())
}
