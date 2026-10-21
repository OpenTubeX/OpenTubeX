/**
 * Shaka tries these codec prefixes in order and retains its supported variants
 * when none match. An empty codec lets its decoding-efficiency preference decide.
 * Preserve automatic HDR selection for the display in every preference entry.
 * @param {string} preference
 * @param {boolean} isVr
 * @returns {{ codec: string, hdrLevel: 'AUTO' }[]}
 */
export function getVideoCodecPreferences(preference, isVr) {
  return getCodecPrefixes(preference, isVr).map(codec => ({ codec, hdrLevel: 'AUTO' }))
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
    default: return ['']
  }
}
