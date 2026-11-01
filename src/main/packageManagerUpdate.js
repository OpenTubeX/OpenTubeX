// @ts-check
import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

/** @typedef {{ packageManager: string, command: string }} PackageManagerUpdate */

const execFileAsync = promisify(execFile)
const REPOSITORY_URL = /^\s*baseurl\s*=.*opentubex/im

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

  const nixStorePath = appPath.match(/^\/nix\/store\/[^/]+/)?.[0]
  if (nixStorePath) {
    /** @type {string | null} */
    let profileName = null
    try {
      const manifest = JSON.parse(await readTextFile(path.join(home, '.nix-profile', 'manifest.json')))
      profileName = Object.entries(manifest.elements ?? {})
        .find(([, element]) => element.storePaths?.includes(nixStorePath))?.[0] ?? null
    } catch {}
    return {
      packageManager: 'Nix',
      command: profileName === null ? 'nix flake update opentubex' : `nix profile upgrade ${profileName}`,
    }
  }

  if (platform === 'darwin') {
    for (const prefix of ['/opt/homebrew', '/usr/local']) {
      if (await exists(`${prefix}/Caskroom/opentubex`)) {
        return { packageManager: 'Homebrew', command: 'brew upgrade --cask opentubex' }
      }
    }
    return null
  }

  if (platform !== 'linux') return null

  /** @param {string} directory */
  const hasRepositoryFile = async directory => {
    try {
      const names = (await listDirectory(directory)).filter(name => name.endsWith('.repo'))
      for (const name of names) {
        if (REPOSITORY_URL.test(await readTextFile(path.join(directory, name)).catch(() => ''))) return true
      }
    } catch {}
    return false
  }

  // Each query fails when its package manager is missing or doesn't own OpenTubeX.
  try {
    const name = (await run('dpkg-query', ['-S', appPath])).split(':')[0].trim()
    const policy = await run('apt-cache', ['policy', name])
    return /opentubex\.org/.test(policy)
      ? { packageManager: 'APT', command: `sudo apt update && sudo apt upgrade ${name}` }
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
