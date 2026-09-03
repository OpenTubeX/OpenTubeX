/**
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

/**
 * Removes navigation destinations that cannot be opened in the current app
 * state while preserving the configured order.
 *
 * @param {string[]} items
 * @param {object} options
 * @param {boolean} options.supportsLocalApi
 * @param {'local' | 'invidious'} options.backendPreference
 * @param {boolean} options.backendFallback
 * @param {boolean} options.showWatchStats
 * @returns {string[]}
 */
export function filterAvailableNavigationItems(items, options) {
  return items
    .filter(id => id !== 'trending' || isTrendingAvailable(options))
    .filter(id => id !== 'popular' || isMostPopularAvailable(options))
    .filter(id => id !== 'stats' || options.showWatchStats)
}
