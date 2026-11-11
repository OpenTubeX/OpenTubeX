import { getDashAudioFormatId, getSabrFormatId } from './formatIds.js'

/**
 * YouTube reports how many decibels a video is louder than its playback
 * target. Like YouTube's player, this only turns loud videos down, because
 * raising quiet ones would clip without a limiter.
 *
 * @param {number | null | undefined} loudnessDb
 * @returns {number}
 */
export function getLoudnessNormalizationGain(loudnessDb) {
  return Number.isFinite(loudnessDb) && loudnessDb > 0 ? 10 ** (-loudnessDb / 20) : 1
}

/**
 * Dubbed and Stable Volume tracks have their own loudness, which YouTube's
 * player uses instead of the video's when `enablePerFormatLoudness` is set.
 * The keys are the IDs Shaka reports as `originalAudioId` for the DASH and
 * SABR manifests.
 *
 * @param {import('youtubei.js').Misc.Format[]} formats
 * @param {boolean | undefined} enablePerFormatLoudness
 * @returns {Record<string, number>}
 */
export function getAudioFormatLoudness(formats, enablePerFormatLoudness) {
  /** @type {Record<string, number>} */
  const loudness = {}
  if (!enablePerFormatLoudness) return loudness

  for (const format of formats) {
    if (!format.has_audio || !Number.isFinite(format.loudness_db)) continue

    loudness[getDashAudioFormatId(format)] = format.loudness_db
    loudness[getSabrFormatId({ itag: format.itag, lastModified: format.last_modified_ms, xtags: format.xtags })] = format.loudness_db
  }

  return loudness
}
