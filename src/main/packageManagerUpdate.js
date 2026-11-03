// @ts-check
import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

/** @typedef {{ packageManager: string, command: string }} PackageManagerUpdate */

const execFileAsync = promisify(execFile)
const REPOSITORY_URL = /^\s*baseurl\s*=.*opentubex/im
const REPOSITORY_DISABLED = /^\s*enabled\s*=\s*0/m

/**
 * @param {string} file
 * @param {string[]} args
 */
async function runCommand(file, args) {
  const { stdout } = await execFileAsync(file, args, {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return stdout
}

/** @param {string} filePath */
async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Finds the package manager that installed OpenTubeX and the command that
 * updates it. Installs that are not tied to a repository, such as a manually
 * downloaded .deb, return null because the website download updates them.
 * @param {string} appPath path of the running app.asar
 * @returns {Promise<PackageManagerUpdate | null>}
 */
export async function getPackageManagerUpdate(appPath, {
  platform = process.platform,
  env = process.env,
  home = homedir(),
  run = runCommand,
  readTextFile = (/** @type {string} */ filePath) => readFile(filePath, 'utf8'),
  listDirectory = readdir,
  exists = pathExists,
} = {}) {
  if (env.FLATPAK_ID) {
    return { packageManager: 'Flatpak', command: `flatpak update ${env.FLATPAK_ID}` }
  }

  // Revisions of snaps installed from a file start with x.
  if (env.SNAP_NAME) {
    return env.SNAP_REVISION?.startsWith('x')
      ? null
      : { packageManager: 'Snap', command: `sudo snap refresh ${env.SNAP_NAME}` }
  }

  // Declarative Nix installs update through a rebuild that depends on the
  // user's configuration, so only profile installs get a command.
  const nixStorePath = appPath.match(/^\/nix\/store\/[^/]+/)?.[0]
  if (nixStorePath) {
    // use-xdg-base-directories moves the profile from ~/.nix-profile.
    for (const profile of [
      path.join(home, '.nix-profile'),
      path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'nix', 'profile'),
    ]) {
      try {
        const manifest = JSON.parse(await readTextFile(path.join(profile, 'manifest.json')))
        const profileName = Object.entries(manifest.elements ?? {})
          .find(([, element]) => element.storePaths?.includes(nixStorePath))?.[0]
        if (profileName) return { packageManager: 'Nix', command: `nix profile upgrade ${profileName}` }
      } catch {}
    }
    return null
  }

  if (platform === 'darwin') {
    if (!appPath.startsWith('/Applications/OpenTubeX.app/')) return null
    for (const prefix of ['/opt/homebrew', '/usr/local']) {
      for (const cask of ['opentubex', 'opentubex@nightly']) {
        if (await exists(`${prefix}/Caskroom/${cask}`)) {
          return { packageManager: 'Homebrew', command: `brew upgrade --cask ${cask}` }
        }
      }
    }
    return null
  }

  if (platform === 'win32') {
    // Scoop installs apps to <root>\apps\<name>\<version or current>.
    const name = appPath.match(/[\\/]apps[\\/](opentubex(?:-nightly)?)[\\/][^\\/]+[\\/]resources[\\/]app\.asar$/i)?.[1]
    if (!name) return null
    try {
      // Apps installed from a manifest file or URL have no bucket to update from.
      const install = JSON.parse(await readTextFile(path.win32.join(appPath, '..', '..', 'install.json')))
      if (install.bucket) return { packageManager: 'Scoop', command: `scoop update ${name}` }
    } catch {}
    return null
  }

  if (platform !== 'linux') return null

  /** @param {string} directory */
  const hasRepositoryFile = async directory => {
    try {
      const names = (await listDirectory(directory)).filter(name => name.endsWith('.repo'))
      for (const name of names) {
        const sections = (await readTextFile(path.join(directory, name)).catch(() => '')).split(/^(?=\s*\[)/m)
        if (sections.some(section => REPOSITORY_URL.test(section) && !REPOSITORY_DISABLED.test(section))) return true
      }
    } catch {}
    return false
  }

  // Each query fails when its package manager is missing or doesn't own OpenTubeX.
  try {
    const name = (await run('dpkg-query', ['-S', appPath])).split(':')[0].trim()
    const policy = await run('apt-cache', ['policy', name])
    return /opentubex\.org/.test(policy)
      ? { packageManager: 'APT', command: `sudo apt update && sudo apt install --only-upgrade ${name}` }
      : null
  } catch {}

  try {
    const name = (await run('rpm', ['-qf', '--qf', '%{NAME}', appPath])).trim()
    if (await hasRepositoryFile('/etc/zypp/repos.d')) {
      return { packageManager: 'Zypper', command: `sudo zypper update ${name}` }
    }
    if (await hasRepositoryFile('/etc/yum.repos.d')) {
      return { packageManager: 'DNF', command: `sudo dnf upgrade ${name}` }
    }
    return null
  } catch {}

  try {
    const name = (await run('pacman', ['-Qqo', appPath])).trim()
    // Lists the package only when no configured repository provides it.
    const foreign = await run('pacman', ['-Qqm', name]).then(() => true, () => false)
    if (!foreign) return { packageManager: 'pacman', command: 'sudo pacman -Syu' }

    const pathDirectories = (env.PATH ?? '').split(path.delimiter).filter(Boolean)
    for (const [helper, command] of [['paru', 'paru -Syu'], ['yay', 'yay -Syu'], ['shelly', 'shelly upgrade all']]) {
      for (const directory of pathDirectories) {
        if (await exists(path.join(directory, helper))) {
          return { packageManager: 'AUR', command }
        }
      }
    }
  } catch {}

  return null
}
