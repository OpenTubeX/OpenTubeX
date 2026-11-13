// GrapheneOS can block the native libraries that youtubedl-android unpacks into app data.
const BLOCKED_NATIVE_LIBRARY = /couldn't map "[^"]*\/youtubedl-android\/[^"]*" segment \d+: Permission denied/

/**
 * Whether Android refused to load yt-dlp's native libraries, which no yt-dlp update can fix.
 * @param {string} error
 * @returns {boolean}
 */
function isBlockedNativeCodeError(error) {
  return BLOCKED_NATIVE_LIBRARY.test(error)
}

/**
 * Whether updating or switching yt-dlp could help with a failed download. It can't when Android
 * blocked its native code or the process was killed.
 * @param {string} error
 * @returns {boolean}
 */
export function suggestsYtDlpUpdate(error) {
  return error !== 'DOWNLOAD_STOPPED_UNEXPECTEDLY' && !isBlockedNativeCodeError(error)
}

/**
 * Translate application errors while preserving yt-dlp's diagnostic output.
 * @param {string} error
 * @param {(key: string) => string} translate
 * @returns {string}
 */
export function downloadErrorMessage(error, translate) {
  if (error === 'DOWNLOAD_EXPORT_FAILED') return translate('Downloads.Export Failed')
  if (error === 'IOS_DOWNLOAD_FAILED') return translate('Downloads.Download Failed')
  if (error === 'DOWNLOAD_STOPPED_UNEXPECTEDLY') return translate('Downloads.Download Stopped Unexpectedly')
  if (error === 'INVALID_MEDIA_URL') return translate('Video.Invalid Media URL')
  if (isBlockedNativeCodeError(error)) return translate('Downloads.Native Code Blocked')
  return error
}
