/**
 * The stream ID the SABR manifest parser gives a format, which Shaka reports
 * as `originalAudioId` or `originalVideoId`.
 *
 * @param {{ itag: number, lastModified?: string, xtags?: string }} format
 * @returns {string}
 */
export function getSabrFormatId(format) {
  return `${format.itag}-${format.lastModified ?? '0'}-${format.xtags ?? ''}`
}

/**
 * The representation ID youtubei.js's `toDash` gives an audio format, which
 * Shaka reports as `originalAudioId`.
 *
 * @param {import('youtubei.js').Misc.Format} format
 * @returns {string}
 */
export function getDashAudioFormatId(format) {
  const parts = [format.itag.toString()]
  if (format.audio_track) parts.push(format.audio_track.id)
  if (format.is_drc) parts.push('drc')
  if (format.is_vb) parts.push('vb')
  return parts.join('-')
}
