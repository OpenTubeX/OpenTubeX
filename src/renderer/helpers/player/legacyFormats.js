/**
 * @typedef {{ width: number, height: number, bitrate: number }} LegacyFormat
 */

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
  const isPortrait = legacyFormats[0].height > legacyFormats[0].width

  /** @param {LegacyFormat} format */
  const resolutionOf = (format) => isPortrait ? format.width : format.height

  const exactMatches = legacyFormats.filter(format => resolutionOf(format) === preferredQuality)

  if (exactMatches.length > 0) {
    return exactMatches[0]
  }

  const lowerQualityMatches = legacyFormats.filter(format => resolutionOf(format) < preferredQuality)

  if (lowerQualityMatches.length > 0) {
    // highest quality below the preferred one
    return lowerQualityMatches.sort((a, b) => b.bitrate - a.bitrate)[0]
  }

  // everything is above the preferred quality, so use the lowest quality one
  return legacyFormats.toSorted((a, b) => a.bitrate - b.bitrate)[0]
}
