import { supportsYtDlp } from './ytDlpCapabilities.js'

/**
 * @param {Record<string, unknown>} getters
 * @param {boolean} [supported]
 * @param {boolean} [isCapacitor]
 */
export function hasConfiguredRestrictedPlaybackAuthentication(
  getters,
  supported = (supportsYtDlp && !process.env.IS_IOS),
  isCapacitor = Boolean(process.env.IS_CAPACITOR)
) {
  const cookiePath = getters.getYtDlpPlaybackCookiesPath
  const browser = getters.getYtDlpPlaybackCookiesBrowser
  const cookieFileConfigured = getters.getYtDlpPlaybackAuthMode === 'file' &&
    typeof cookiePath === 'string' && cookiePath.trim() !== ''
  const browserConfigured = !isCapacitor && getters.getYtDlpPlaybackAuthMode === 'browser' &&
    typeof browser === 'string' && browser.trim() !== ''

  return Boolean(supported && (cookieFileConfigured || browserConfigured))
}

/**
 * @param {boolean} isMembersOnly
 * @param {Record<string, unknown>} getters
 * @param {boolean} [isElectron]
 */
export function shouldHideMembersOnlyContent(isMembersOnly, getters, isElectron = (supportsYtDlp && !process.env.IS_IOS)) {
  return Boolean(isMembersOnly && !hasConfiguredRestrictedPlaybackAuthentication(getters, isElectron))
}
