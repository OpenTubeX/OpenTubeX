// @ts-check

/**
 * What yt-dlp uses the configured cookies for. Age-restricted and members-only
 * videos can always try them on request.
 * @typedef {'playback' | 'downloads' | 'subtitles'} YtDlpCookieUse
 */

/** @type {readonly YtDlpCookieUse[]} */
export const YT_DLP_COOKIE_USES = Object.freeze(['playback', 'downloads', 'subtitles'])

/** @type {readonly YtDlpCookieUse[]} */
export const DEFAULT_YT_DLP_COOKIE_USES = Object.freeze(['downloads'])

/**
 * Whether the saved Use Cookies For setting includes a use.
 * @param {unknown} setting the saved value, undefined while it was never saved
 * @param {YtDlpCookieUse} use
 */
export function usesYtDlpCookiesFor(setting, use) {
  return (Array.isArray(setting) ? setting : DEFAULT_YT_DLP_COOKIE_USES).includes(use)
}

/**
 * The Use Cookies For setting that replaced the Always Use Cookies, Use
 * Cookies for Downloads and Use Cookies for Subtitles switches. Always Use
 * Cookies also covered downloads and subtitles.
 * @param {{ always?: unknown, downloads?: unknown, subtitles?: unknown }} switches
 *   the saved switches, undefined where they were never saved
 * @returns {YtDlpCookieUse[]}
 */
export function ytDlpCookieUsesFromSwitches({ always, downloads, subtitles }) {
  if (always === true) return [...YT_DLP_COOKIE_USES]
  return YT_DLP_COOKIE_USES.filter(use =>
    (use === 'downloads' && downloads !== false) || (use === 'subtitles' && subtitles === true))
}
