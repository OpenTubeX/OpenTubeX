// @ts-check

// The external player arguments the user approved in a native dialog.
export const EXTERNAL_PLAYER_APPROVED_ARGS_SETTING = 'externalPlayerApprovedArgs'

// Written only by native pickers, native dialogs or main-process services.
const MAIN_PROCESS_SETTINGS = new Set([
  EXTERNAL_PLAYER_APPROVED_ARGS_SETTING,
  'screenshotFolderPath',
  'scheduledBackupFolderPath',
  'scheduledBackupStatus',
])

// Programs and scripts that main runs, the download destination, and the
// cookie file that yt-dlp writes back. Native pickers set them, so a
// compromised renderer cannot point them anywhere. The renderer may still
// reset them to their default.
export const PICKER_PATH_SETTINGS = Object.freeze([
  'externalPlayerExecutable',
  'videoIpBlockScriptPath',
  'ytDlpDownloadFolderPath',
  'ytDlpFfmpegPath',
  'ytDlpPath',
  'ytDlpPlaybackCookiesPath',
])
export const EXECUTABLE_PATH_SETTINGS = Object.freeze(['externalPlayerExecutable', 'ytDlpFfmpegPath', 'ytDlpPath'])

/**
 * Whether a browser profile is a name rather than a path. yt-dlp reads a
 * profile that contains a path separator after expanding `~` and environment
 * variables, and `:` would start a container name, so only the folder picker
 * may set those.
 * @param {unknown} value
 */
export function isBrowserProfileName(value) {
  return typeof value === 'string' && !/[/\\:~$%]/.test(value)
}

/**
 * Whether a `DB_SETTINGS` upsert from the renderer may write this value.
 * @param {unknown} settingId
 * @param {unknown} value
 */
export function canRendererWriteSetting(settingId, value) {
  if (typeof settingId !== 'string' || MAIN_PROCESS_SETTINGS.has(settingId)) return false
  if (settingId === 'ytDlpPlaybackCookiesBrowserProfile') return isBrowserProfileName(value)
  return !PICKER_PATH_SETTINGS.includes(settingId) || value === ''
}
