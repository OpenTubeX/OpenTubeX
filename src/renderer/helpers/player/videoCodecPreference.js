// Shaka counts matching attributes equally. Chromium can report software AV1 as
// smooth and hardware VP9 as not smooth, so including both creates a tie that
// lets lower-bandwidth software decoding win. Prefer hardware decoding alone.
export const preferredVideoDecodingAttributes = ['powerEfficient']

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
