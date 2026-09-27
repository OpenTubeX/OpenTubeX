/**
 * Translate application errors while preserving yt-dlp's diagnostic output.
 * @param {string} error
 * @param {(key: string) => string} translate
 * @returns {string}
 */
export function downloadErrorMessage(error, translate) {
  if (error === 'DOWNLOAD_EXPORT_FAILED') return translate('Downloads.Export Failed')
  if (error === 'IOS_DOWNLOAD_FAILED') return translate('Downloads.Download Failed')
  return error
}
