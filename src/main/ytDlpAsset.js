/**
 * @param {NodeJS.Platform} platform
 * @param {NodeJS.Architecture} arch
 * @returns {string}
 */
export function getYtDlpAssetName(platform, arch) {
  switch (platform) {
    case 'win32':
      return 'yt-dlp.exe'
    case 'darwin':
      return 'yt-dlp_macos'
    default:
      if (arch === 'x64') {
        return 'yt-dlp_linux'
      }
      if (arch === 'arm64') {
        return 'yt-dlp_linux_aarch64'
      }
      return 'yt-dlp'
  }
}

/**
 * @param {object} validators
 * @param {string} source
 * @param {'stable' | 'nightly' | 'master'} [channel]
 * @returns {{ etag: string | null, lastModified: string | null } | null}
 */
export function getMatchingDownloadValidators(validators, source, channel) {
  if (validators === null || validators.source !== source ||
    (channel !== undefined && validators.channel !== channel)) {
    return null
  }

  return {
    etag: typeof validators.etag === 'string' ? validators.etag : null,
    lastModified: typeof validators.lastModified === 'string' ? validators.lastModified : null
  }
}
