/**
 * Provider availability for navigation entries. Distraction-free settings
 * are intentionally handled by each navigation surface separately.
 * @param {object} options
 * @param {boolean} options.supportsLocalApi
 * @param {'local' | 'invidious'} options.backendPreference
 * @param {boolean} options.backendFallback
 * @returns {boolean}
 */
export function isTrendingAvailable({ supportsLocalApi, backendPreference, backendFallback }) {
  return supportsLocalApi && (backendFallback || backendPreference === 'local')
}

/**
 * @param {object} options
 * @param {'local' | 'invidious'} options.backendPreference
 * @param {boolean} options.backendFallback
 * @returns {boolean}
 */
export function isMostPopularAvailable({ backendPreference, backendFallback }) {
  return backendFallback || backendPreference === 'invidious'
}
