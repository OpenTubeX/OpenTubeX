// @ts-check

// Written only by native pickers or main-process services.
const MAIN_PROCESS_SETTINGS = new Set(['screenshotFolderPath', 'scheduledBackupFolderPath', 'scheduledBackupStatus'])

// Programs that main spawns and the download destination. Native pickers set
// them, so a compromised renderer cannot point them anywhere. The renderer may
// still reset them to their default.
export const PICKER_PATH_SETTINGS = Object.freeze(['externalPlayerExecutable', 'ytDlpDownloadFolderPath', 'ytDlpFfmpegPath', 'ytDlpPath'])
export const EXECUTABLE_PATH_SETTINGS = Object.freeze(['externalPlayerExecutable', 'ytDlpFfmpegPath', 'ytDlpPath'])

/**
 * Whether a `DB_SETTINGS` upsert from the renderer may write this value.
 * @param {unknown} settingId
 * @param {unknown} value
 */
export function canRendererWriteSetting(settingId, value) {
  if (typeof settingId !== 'string' || MAIN_PROCESS_SETTINGS.has(settingId)) return false
  return !PICKER_PATH_SETTINGS.includes(settingId) || value === ''
}
