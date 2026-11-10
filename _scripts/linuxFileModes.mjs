import { chmod, lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Remove group and other write access from the packaged Linux app.
 *
 * electron-builder applies the modes stored in Electron's zip, and the
 * Electron 44.10 Linux zips store 0777 and 0666. Without this, the deb, rpm
 * and pacman packages install a world-writable executable.
 *
 * @param {Pick<import('electron-builder').AfterPackContext, 'appOutDir' | 'electronPlatformName'>} context
 */
export async function removeLinuxGroupOtherWrite ({ appOutDir, electronPlatformName }) {
  if (electronPlatformName !== 'linux') {
    return
  }

  const paths = await readdir(appOutDir, { recursive: true })
  for (const path of [appOutDir, ...paths.map(path => join(appOutDir, path))]) {
    const stats = await lstat(path)
    // chmod follows symlinks, and link modes are meaningless on Linux.
    if (!stats.isSymbolicLink() && (stats.mode & 0o022) !== 0) {
      await chmod(path, stats.mode & 0o7755)
    }
  }
}
