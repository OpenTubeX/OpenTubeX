import { FormatUtils, Misc } from 'youtubei.js'

import { MANIFEST_TYPE_DASH, MANIFEST_TYPE_HLS } from './utils'
import { probeStreamByteRanges } from './streamByteRanges'
import { generateAudioTrackField } from '../api/local'
import { waitForYtDlpFormatAvailability } from './ytDlpFormatAvailability'
import { getEarliestYtDlpFormatExpiry, YtDlpPlaybackSourceCache } from './ytDlpPlaybackCache'

/** @typedef {import('../../../main/ytDlp').YtDlpPlaybackFormat} YtDlpPlaybackFormat */

/**
 * @typedef {object} YtDlpPlaybackSource
 * @property {string} manifestSrc
 * @property {MANIFEST_TYPE_DASH | MANIFEST_TYPE_HLS} manifestMimeType
 * @property {any[]} legacyFormats
 * @property {Date | null} expiryDate
 * @property {boolean} isLive
 * @property {string | null} version the yt-dlp version that extracted the streams
 */

// yt-dlp appends the audio track or a suffix like "-drc" to the itag for some formats
const ITAG_REGEX = /^\d+/
const dashPlaybackSourceCache = new YtDlpPlaybackSourceCache()

/**
 * Ensures playback-error recovery extracts fresh signed stream URLs.
 * @param {string} videoId
 */
export function invalidateYtDlpPlaybackSource(videoId) {
  dashPlaybackSourceCache.delete(videoId)
  window.ftElectron.ytDlpPlaybackCacheDelete(videoId).catch(error => {
    console.warn('Could not remove an entry from the persistent yt-dlp playback cache', error)
  })
}

export function invalidateAllYtDlpPlaybackSources() {
  dashPlaybackSourceCache.clear()
  window.ftElectron.ytDlpPlaybackCacheClear().catch(error => {
    console.warn('Could not clear the persistent yt-dlp playback cache', error)
  })
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function isVideoFormat(format) {
  return format.vcodec !== null && format.vcodec !== 'none'
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function isAudioFormat(format) {
  return format.acodec !== null && format.acodec !== 'none'
}

/**
 * @param {YtDlpPlaybackFormat} format
 * @returns {string} e.g. `video/mp4; codecs="av01.0.12M.08"`
 */
function buildMimeType(format) {
  const container = format.ext === 'webm' ? 'webm' : 'mp4'

  if (isVideoFormat(format)) {
    const codecs = isAudioFormat(format) ? `${format.vcodec}, ${format.acodec}` : format.vcodec
    return `video/${container}; codecs="${codecs}"`
  }

  return `audio/${container}; codecs="${format.acodec}"`
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function buildQualityLabel(format) {
  if (format.height === null) {
    return format.formatNote ?? 'unknown'
  }

  return format.fps !== null && format.fps > 30 ? `${format.height}p${Math.round(format.fps)}` : `${format.height}p`
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function buildColorInfo(format) {
  switch (format.dynamicRange) {
    case 'HDR10':
      return {
        primaries: 'COLOR_PRIMARIES_BT2020',
        transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084',
        matrixCoefficients: 'COLOR_MATRIX_COEFFICIENTS_BT2020_NCL'
      }
    case 'HLG':
      return {
        primaries: 'COLOR_PRIMARIES_BT2020',
        transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_ARIB_STD_B67',
        matrixCoefficients: 'COLOR_MATRIX_COEFFICIENTS_BT2020_NCL'
      }
    case 'SDR':
    case null:
      // Players compare the colour information to tell otherwise identical resolutions
      // apart, so it has to be stated for SDR streams too rather than left out,
      // which is also what YouTube's own API reports for them
      return {
        primaries: 'COLOR_PRIMARIES_BT709',
        transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_BT709',
        matrixCoefficients: 'COLOR_MATRIX_COEFFICIENTS_BT709'
      }
    default:
      // Claiming the wrong colour space is worse than not stating one at all,
      // so anything we don't recognise (e.g. Dolby Vision) is left to the player
      return undefined
  }
}

/**
 * @param {URL} url
 * @returns {number | undefined} the stream duration in milliseconds
 */
function getApproxDurationMs(url) {
  const duration = parseFloat(url.searchParams.get('dur'))

  return Number.isFinite(duration) ? Math.round(duration * 1000) : undefined
}

/**
 * @param {YtDlpPlaybackFormat} format
 * @param {import('./streamByteRanges').StreamByteRanges} byteRanges
 * @param {number | null} fallbackDuration the video duration in seconds
 * @returns {import('youtubei.js').Misc.Format}
 */
function convertYtDlpToLocalFormat(format, byteRanges, fallbackDuration) {
  const url = new URL(format.url)
  const isVideo = isVideoFormat(format)

  const localFormat = new Misc.Format({
    itag: parseInt(ITAG_REGEX.exec(format.formatId)?.[0] ?? '0'),
    mimeType: buildMimeType(format),
    bitrate: format.bitrate ?? 0,
    ...(format.width !== null && format.height !== null ? { width: format.width, height: format.height } : {}),
    initRange: byteRanges.initRange,
    indexRange: byteRanges.indexRange,
    url: format.url,
    approxDurationMs: getApproxDurationMs(url) ??
      (fallbackDuration === null ? undefined : Math.round(fallbackDuration * 1000)),
    ...(isVideo
      ? {
          fps: format.fps ?? undefined,
          qualityLabel: buildQualityLabel(format),
          colorInfo: buildColorInfo(format)
        }
      : {
          audioQuality: 'AUDIO_QUALITY_MEDIUM',
          audioSampleRate: format.audioSampleRate ?? undefined,
          audioChannels: format.audioChannels ?? undefined
        })
  })

  if (localFormat.has_audio) {
    // googlevideo puts the audio track details into the URL rather than into yt-dlp's output
    const xtags = (url.searchParams.get('xtags') ?? '').split(':')

    localFormat.language = xtags.find(tag => tag.startsWith('lang='))?.split('=')[1] || format.language
    localFormat.is_drc = xtags.includes('drc=1')

    const audioContent = xtags.find(tag => tag.startsWith('acont='))?.split('=')[1]
    localFormat.is_dubbed = audioContent === 'dubbed'
    localFormat.is_descriptive = audioContent === 'descriptive'
    localFormat.is_secondary = audioContent === 'secondary'
    localFormat.is_auto_dubbed = audioContent === 'dubbed-auto'
    localFormat.is_original = audioContent === 'original' ||
      (
        !localFormat.is_dubbed &&
        !localFormat.is_descriptive &&
        !localFormat.is_secondary &&
        !localFormat.is_auto_dubbed &&
        !localFormat.is_drc
      )
  }

  return localFormat
}

/**
 * @param {YtDlpPlaybackFormat} format
 */
function mapYtDlpLegacyFormat(format) {
  return {
    itag: parseInt(ITAG_REGEX.exec(format.formatId)?.[0] ?? '0'),
    qualityLabel: buildQualityLabel(format),
    fps: format.fps,
    bitrate: format.bitrate,
    mimeType: buildMimeType(format),
    height: format.height,
    width: format.width,
    url: format.url,
    availableAt: format.availableAt
  }
}

/**
 * Reads the byte ranges of every adaptive format in parallel and drops the ones
 * that the byte ranges couldn't be determined for.
 * @param {YtDlpPlaybackFormat[]} formats
 * @param {number | null} duration
 */
async function convertAdaptiveFormats(formats, duration) {
  const results = await Promise.all(formats.map(async (format) => {
    try {
      if (!await waitForYtDlpFormatAvailability(format)) {
        return null
      }

      const byteRanges = await probeStreamByteRanges(format.url, format.ext === 'webm')

      return byteRanges === null ? null : convertYtDlpToLocalFormat(format, byteRanges, duration)
    } catch (error) {
      console.error(`Failed to read the byte ranges of yt-dlp format ${format.formatId}`, error)
      return null
    }
  }))

  const localFormats = results.filter(format => format !== null)
  const audioFormats = localFormats.filter(format => format.has_audio)

  // YouTube only labels the audio tracks when there is more than one to choose from
  if (new Set(audioFormats.map(format => `${format.language}-${format.is_original}`)).size > 1) {
    // match YouTube's local API response with English
    const languageNames = new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' })

    for (const format of audioFormats) {
      generateAudioTrackField(format, languageNames)
    }
  }

  return localFormats
}

/**
 * Uses yt-dlp to get the stream URLs for a video, which avoids YouTube's error prone
 * SABR streaming protocol. Live streams use YouTube's HLS manifests, which keep the
 * DVR window available, so that they can be rewound.
 * @param {string} videoId
 * @param {string} cacheKey identifies the yt-dlp executable and proxy configuration
 * @returns {Promise<YtDlpPlaybackSource>}
 */
export async function getYtDlpPlaybackSource(videoId, cacheKey = '') {
  let cachedSource = dashPlaybackSourceCache.get(videoId, cacheKey)

  if (cachedSource === null) {
    try {
      const entry = await window.ftElectron.ytDlpPlaybackCacheGet(videoId, cacheKey)
      if (entry !== null) {
        const source = { ...entry.source, expiryDate: new Date(entry.expiryTime) }
        dashPlaybackSourceCache.set(videoId, cacheKey, source)
        cachedSource = dashPlaybackSourceCache.get(videoId, cacheKey)

        if (cachedSource === null) {
          await window.ftElectron.ytDlpPlaybackCacheDelete(videoId)
        }
      }
    } catch (error) {
      console.warn('Could not read the persistent yt-dlp playback cache', error)
    }
  }

  if (cachedSource !== null) {
    return cachedSource
  }

  let extractionError = null

  for (const useDefaultClients of [false, true]) {
    const info = await window.ftElectron.ytDlpGetPlaybackInfo(videoId, useDefaultClients)

    if (info === null) {
      throw new Error('yt-dlp is not available')
    }

    if ('error' in info) {
      if (info.error === 'ENOENT') {
        throw new Error('yt-dlp could not be found')
      }

      extractionError = new Error(info.error)
      continue
    }

    const httpFormats = info.formats.filter(format => format.protocol === 'https' && format.url !== null)
    const legacyFormats = httpFormats
      .filter(format => isVideoFormat(format) && isAudioFormat(format))
      .map(mapYtDlpLegacyFormat)

    // live streams are only available as HLS, which is what makes rewinding within
    // the DVR window possible
    if (!info.isLive && info.liveStatus !== 'is_live') {
      const adaptiveFormats = httpFormats.filter(format => !(isVideoFormat(format) && isAudioFormat(format)))
      const localFormats = await convertAdaptiveFormats(adaptiveFormats, info.duration)

      if (localFormats.some(format => format.has_video) && localFormats.some(format => format.has_audio)) {
        const manifest = await FormatUtils.toDash({ adaptive_formats: localFormats })

        const source = {
          manifestSrc: `data:${MANIFEST_TYPE_DASH};charset=UTF-8,${encodeURIComponent(manifest)}`,
          manifestMimeType: MANIFEST_TYPE_DASH,
          legacyFormats,
          expiryDate: getEarliestYtDlpFormatExpiry(adaptiveFormats),
          isLive: false,
          version: info.version
        }

        dashPlaybackSourceCache.set(videoId, cacheKey, source)
        try {
          await window.ftElectron.ytDlpPlaybackCacheSet(
            videoId,
            cacheKey,
            source.expiryDate?.getTime() ?? NaN,
            source
          )
        } catch (error) {
          console.warn('Could not save the persistent yt-dlp playback cache', error)
        }
        return source
      }
    }

    if (info.hlsManifestUrl !== null) {
      return {
        manifestSrc: info.hlsManifestUrl,
        manifestMimeType: MANIFEST_TYPE_HLS,
        legacyFormats,
        expiryDate: null,
        isLive: info.isLive,
        version: info.version
      }
    }

    extractionError = new Error('yt-dlp did not return any playable formats')
  }

  throw extractionError ?? new Error('yt-dlp did not return any playable formats')
}
