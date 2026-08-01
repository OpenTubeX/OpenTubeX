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
