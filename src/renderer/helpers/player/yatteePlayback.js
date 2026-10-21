import { FormatUtils, Misc } from 'youtubei.js'
import { probeStreamByteRanges } from './streamByteRanges'
import { getCompatibleAdaptiveFormats } from './compatibleAdaptiveFormats'
import { generateAudioTrackField } from '../api/local'
import { getYatteeUpstreamUrl } from '../api/yattee'
import { mapConcurrently } from '../concurrent-map'

// Browsers only open six connections per server, and a probe's timeout starts with its
// request, so starting every probe at once lets the queued ones time out on slow servers
const PROBE_CONCURRENCY = 6

/**
 * @param {string | undefined} range e.g. "0-700"
 * @returns {{ start: number, end: number } | null}
 */
function parseByteRange(range) {
  const [start, end] = (range ?? '').split('-').map(value => parseInt(value, 10))
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

/**
 * The server reports the container as the MIME subtype, which isn't valid for m4a.
 * @param {string} type
 */
function normalizeMimeType(type) {
  return type.replace(/^audio\/m4a\b/, 'audio/mp4')
}

/**
 * @param {any} format a Yattee adaptive format
 * @param {{ initRange: { start: number, end: number }, indexRange: { start: number, end: number } }} byteRanges
 * @param {number} lengthSeconds
 */
function convertYatteeToLocalFormat(format, byteRanges, lengthSeconds) {
  // A relay URL hides the stream details that googlevideo puts into its URL
  const upstreamUrl = new URL(getYatteeUpstreamUrl(format.url))
  const duration = parseFloat(upstreamUrl.searchParams.get('dur'))
  const isAudio = format.type.startsWith('audio/')

  const localFormat = new Misc.Format({
    itag: parseInt(format.itag, 10),
    mimeType: normalizeMimeType(format.type),
    bitrate: parseInt(format.bitrate, 10) || 0,
    ...(format.width && format.height ? { width: format.width, height: format.height } : {}),
    initRange: byteRanges.initRange,
    indexRange: byteRanges.indexRange,
    url: format.url,
    approxDurationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : lengthSeconds * 1000,
    ...(isAudio
      ? { audioQuality: 'AUDIO_QUALITY_MEDIUM' }
      : {
          fps: format.fps ?? undefined,
          qualityLabel: format.fps > 30 ? `${format.height}p${format.fps}` : `${format.height}p`
        })
  })

  if (localFormat.has_audio) {
    const xtags = (upstreamUrl.searchParams.get('xtags') ?? '').split(':')

    localFormat.language = xtags.find(tag => tag.startsWith('lang='))?.split('=')[1] || format.audioTrack?.id || null
    localFormat.is_drc = xtags.includes('drc=1') || String(format.itag).endsWith('-drc')

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
 * yattee-server leaves out the byte ranges of the initialization and index sections
 * that a DASH manifest needs, so they are read from the start of each stream,
 * like for yt-dlp's formats. Formats whose byte ranges can't be determined are dropped.
 * @param {any[]} adaptiveFormats
 * @param {number} lengthSeconds
 * @param {string} serverUrl
 * @returns {Promise<string | null>} a DASH manifest data URL, or null if no streams could be read
 */
export async function createYatteeDashManifest(adaptiveFormats, lengthSeconds, serverUrl) {
  // Every probe costs a request, so skip the formats the player can't decode anyway
  const supportedFormats = typeof MediaSource === 'undefined'
    ? adaptiveFormats
    : adaptiveFormats.filter(format => MediaSource.isTypeSupported(normalizeMimeType(format.type)))

  const results = await mapConcurrently(supportedFormats, PROBE_CONCURRENCY, async (format) => {
    try {
      const initRange = parseByteRange(format.init)
      const indexRange = parseByteRange(format.index)
      const isWebm = format.type.includes('webm')
      // The server's relay forwards Range headers but not googlevideo's range parameter
      const byteRanges = initRange && indexRange
        ? { initRange, indexRange }
        : await probeStreamByteRanges(format.url, isWebm, format.url.startsWith(`${serverUrl}/`))

      return byteRanges === null ? null : convertYatteeToLocalFormat(format, byteRanges, lengthSeconds)
    } catch (error) {
      console.error(`Failed to read the byte ranges of Yattee format ${format.itag}`, error)
      return null
    }
  })

  const formats = results.filter(format => format !== null)
  const audioFormats = formats.filter(format => format.has_audio)

  // YouTube only labels the audio tracks when there is more than one to choose from
  if (new Set(audioFormats.map(format => `${format.language}-${format.is_original}`)).size > 1) {
    // match YouTube's local API response with English
    const languageNames = new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' })

    for (const format of audioFormats) {
      generateAudioTrackField(format, languageNames)
    }
  }

  if (!formats.some(format => format.has_video) || audioFormats.length === 0) {
    return null
  }

  const manifest = await FormatUtils.toDash({ adaptive_formats: getCompatibleAdaptiveFormats(formats) })

  return `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(manifest)}`
}
