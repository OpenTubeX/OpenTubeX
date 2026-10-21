/**
 * Shaka filters the manifest by codec prefix before applying exact-match video
 * preferences. The final codec-free entry preserves automatic HDR selection when
 * a full codec identifier does not exactly match a prefix, or no codec matches.
 * @param {string} preference
 * @param {boolean} isVr
 * @returns {{ codec: string, hdrLevel: 'AUTO' }[]}
 */
export function getVideoCodecPreferences(preference, isVr) {
  return [...getCodecPrefixes(preference, isVr), ''].map(codec => ({ codec, hdrLevel: 'AUTO' }))
}

/**
 * @param {string} preference
 * @param {boolean} isVr
 * @returns {string[]}
 */
function getCodecPrefixes(preference, isVr) {
  // YouTube's VP9 VR streams fail Chromium's projection metadata validation.
  if (isVr) return preference === 'h264' ? ['avc1', 'av01'] : ['av01', 'avc1']

  switch (preference) {
    case 'av1': return ['av01']
    case 'vp9': return ['vp09', 'vp9']
    case 'h264': return ['avc1']
    default: return []
  }
}
