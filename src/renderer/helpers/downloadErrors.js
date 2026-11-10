// GrapheneOS can block the native libraries that youtubedl-android unpacks into app data.
const BLOCKED_NATIVE_LIBRARY = /couldn't map "[^"]*\/youtubedl-android\/[^"]*" segment \d+: Permission denied/

/**
 * Whether Android refused to load yt-dlp's native libraries, which no yt-dlp update can fix.
 * @param {string} error
 * @returns {boolean}
 */
export function isBlockedNativeCodeError(error) {
  return BLOCKED_NATIVE_LIBRARY.test(error)
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
  if (error === 'INVALID_MEDIA_URL') return translate('Video.Invalid Media URL')
  if (isBlockedNativeCodeError(error)) return translate('Downloads.Native Code Blocked')
  return error
}
