import { existsSync } from 'node:fs'

/**
 * @param {string} [platform]
 * @param {boolean} [isFlatpak]
 */
export function shouldUseGioTrash(
  platform = process.platform,
  isFlatpak = existsSync('/.flatpak-info')
) {
  return platform === 'linux' && isFlatpak
}
