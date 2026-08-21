/**
 * @param {Record<string, unknown>} getters
 * @param {boolean} [isElectron]
 */
export function hasConfiguredRestrictedPlaybackAuthentication(
  getters,
  isElectron = process.env.IS_ELECTRON
) {
  const cookiePath = getters.getYtDlpPlaybackCookiesPath
  const browser = getters.getYtDlpPlaybackCookiesBrowser
  const cookieFileConfigured = getters.getYtDlpPlaybackAuthMode === 'file' &&
    typeof cookiePath === 'string' && cookiePath.trim() !== ''
  const browserConfigured = getters.getYtDlpPlaybackAuthMode === 'browser' &&
    typeof browser === 'string' && browser.trim() !== ''

  return Boolean(isElectron && (cookieFileConfigured || browserConfigured))
}

/**
 * @param {boolean} isMembersOnly
 * @param {Record<string, unknown>} getters
 * @param {boolean} [isElectron]
 */
export function shouldHideMembersOnlyContent(isMembersOnly, getters, isElectron = process.env.IS_ELECTRON) {
  return Boolean(isMembersOnly && !hasConfiguredRestrictedPlaybackAuthentication(getters, isElectron))
}
