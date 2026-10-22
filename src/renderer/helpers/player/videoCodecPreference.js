// Shaka counts matching entries, so repeat powerEfficient intentionally to give
// hardware decoding two points and smoothness one. This keeps software AV1 from
// tying with hardware VP9 while preserving smoothness as the tie-breaker when
// both codecs use hardware decoding, or neither does.
export const preferredVideoDecodingAttributes = ['powerEfficient', 'powerEfficient', 'smooth']

/**
 * Shaka filters the manifest by codec prefix before applying exact-match video
 * preferences. The final codec-free entry preserves automatic HDR selection when
 * a full codec identifier does not exactly match a prefix, or no codec matches.
 * @param {string} preference
 * @returns {{ codec: string, hdrLevel: 'AUTO' }[]}
 */
export function getVideoCodecPreferences(preference) {
  return [...getCodecPrefixes(preference), ''].map(codec => ({ codec, hdrLevel: 'AUTO' }))
}

/**
 * @param {string} preference
 * @returns {string[]}
 */
function getCodecPrefixes(preference) {
  switch (preference) {
    case 'av1': return ['av01']
    case 'vp9': return ['vp09', 'vp9']
    case 'h264': return ['avc1']
    default: return []
  }
}
