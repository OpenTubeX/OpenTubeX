/**
 * @typedef {{ width: number | null, height: number | null, bitrate: number | null }} LegacyFormat
 */

/**
 * Returns a function that reads the quality of a legacy format: the width of
 * portrait videos and the height of everything else. Some extractors, such as
 * yt-dlp's Twitch clips, only report a height, so a missing width never makes
 * a video portrait.
 * @param {LegacyFormat[]} legacyFormats
 * @returns {(format: LegacyFormat) => number | null} null when the format has no dimensions
 */
export function getLegacyFormatResolution(legacyFormats) {
  const first = legacyFormats[0]
  const isPortrait = first?.width != null && first.height != null && first.height > first.width

  return (format) => (isPortrait ? format.width ?? format.height : format.height ?? format.width) ?? null
}

/**
 * Picks the legacy format that matches the preferred quality the closest.
 *
 * The legacy formats usually top out at 360p, so the preferred quality is often unavailable,
 * in that case the highest quality below it is used.
 * @param {LegacyFormat[]} legacyFormats
 * @param {number} preferredQuality
 * @returns {LegacyFormat}
 */
export function findLegacyFormatForQuality(legacyFormats, preferredQuality) {
  const readResolution = getLegacyFormatResolution(legacyFormats)
  /** @param {LegacyFormat} format */
  const resolutionOf = (format) => readResolution(format) ?? 0
  // A format without dimensions only counts when no format has them
  const knownFormats = legacyFormats.filter(format => readResolution(format) !== null)
  const candidates = knownFormats.length > 0 ? knownFormats : legacyFormats

  /** @type {(a: LegacyFormat, b: LegacyFormat) => number} */
  const ascending = (a, b) => resolutionOf(a) - resolutionOf(b) || (a.bitrate ?? 0) - (b.bitrate ?? 0)

  const exactMatches = candidates.filter(format => resolutionOf(format) === preferredQuality)

  if (exactMatches.length > 0) {
    return exactMatches[0]
  }

  const lowerQualityMatches = candidates.filter(format => resolutionOf(format) < preferredQuality)

  if (lowerQualityMatches.length > 0) {
    // highest quality below the preferred one, the first listed of equal ones
    return lowerQualityMatches.toSorted((a, b) => ascending(b, a))[0]
  }

  // everything is above the preferred quality, so use the lowest quality one
  return candidates.toSorted(ascending)[0]
}
