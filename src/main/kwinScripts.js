// @ts-check
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Identifies this app's windows in KWin. Inside Flatpak, the sandbox's PID
 * namespace hides the host PID that KWin reports, so match the Flatpak app ID
 * instead. KWin uses it as the desktop file name of sandboxed windows that set
 * an app ID, and only one instance runs per Flatpak app.
 *
 * @typedef {{ processId: number, flatpakId: null } | { processId: null, flatpakId: string }} KwinWindowOwner
 */

/**
 * @param {NodeJS.ProcessEnv} [environment]
 * @param {number} [processId]
 * @returns {KwinWindowOwner}
 */
export function getKwinWindowOwner(environment = process.env, processId = process.pid) {
  const flatpakId = environment.FLATPAK_ID
  return flatpakId ? { processId: null, flatpakId } : { processId, flatpakId: null }
}

/**
 * Plugin name for an owner's script. Inside Flatpak it stays the same across
 * launches, so a launch unloads a script that a crashed one left behind.
 *
 * @param {string} prefix
 * @param {KwinWindowOwner} owner
 */
export function getKwinScriptPluginName(prefix, owner) {
  return `${prefix}-${owner.flatpakId ?? owner.processId}`
}

/**
 * KWin script source of a function that tells whether a KWin window belongs to
 * the owner. Inside Flatpak, a window without an app ID, such as Chromium's
 * Picture-in-Picture window, matches by sharing the PID of a window that has
 * the Flatpak app ID.
 *
 * @param {KwinWindowOwner} owner
 * @returns {string}
 */
export function createKwinWindowOwnerCheck(owner) {
  if (owner.flatpakId === null) return `window => window.pid === ${owner.processId}`

  return `window => workspace.windowList().some(other => other.pid === window.pid && other.desktopFileName === ${JSON.stringify(owner.flatpakId)})`
}

/**
 * @param {{ pid: number, desktopFile: string }} window KWin's D-Bus window info
 * @param {KwinWindowOwner} owner
 */
export function isKwinWindowOwnedBy(window, owner) {
  return owner.flatpakId === null
    ? window.pid === owner.processId
    : window.desktopFile === owner.flatpakId
}

/**
 * Directory for script files that KWin, outside the sandbox, can read. Flatpak
 * shares `$XDG_RUNTIME_DIR/app/$FLATPAK_ID` with the host at the same path.
 *
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function getKwinScriptBaseDirectory(environment = process.env) {
  const { FLATPAK_ID: flatpakId, XDG_RUNTIME_DIR: runtimeDirectory } = environment
  return flatpakId && runtimeDirectory ? join(runtimeDirectory, 'app', flatpakId) : tmpdir()
}

/**
 * Creates a private directory for a KWin script file.
 *
 * @param {string} fileName
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {Promise<{ path: string, write: (source: string) => Promise<void>, remove: () => Promise<void> }>}
 */
export async function createKwinScriptFile(fileName, environment = process.env) {
  const directory = await mkdtemp(join(getKwinScriptBaseDirectory(environment), 'opentubex-kwin-'))
  const path = join(directory, fileName)
  return {
    path,
    write: source => writeFile(path, source, 'utf8'),
    remove: () => rm(directory, { force: true, recursive: true }).catch(() => {}),
  }
}
