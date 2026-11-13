import { app, ipcMain } from 'electron'
import path from 'path'
import cp from 'child_process'
import asyncFs from 'fs/promises'

import { IpcChannels } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { choosePathSetting } from './pathSettingPicker'
import { PROCESS_TREE_SPAWN_OPTIONS, stopProcessTree } from './processTree'
import { isOpenTubeXUrl } from './utils'

/** @type {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }> | null} */
let ipBlockRecoveryScriptPromise = null

/**
 * @param {string} scriptPath
 * @param {number} [timeoutMs] subscription refreshes wait for the run, so a hung script must not block them for the rest of the session
 * @returns {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>}
 */
async function executeIpBlockRecoveryScript(scriptPath, timeoutMs = 5 * 60_000) {
  const configuredPath = (await baseHandlers.settings._findOne('videoIpBlockScriptPath'))?.value
  if (typeof configuredPath !== 'string' || configuredPath.trim().length === 0 ||
    path.resolve(scriptPath) !== path.resolve(configuredPath)) {
    throw new Error('Requested recovery script does not match the saved setting')
  }
  const normalizedPath = path.normalize(path.resolve(configuredPath))
  if (!(await asyncFs.stat(normalizedPath)).isFile()) {
    throw new Error('Recovery script must be a file')
  }

  let command = normalizedPath
  let args = []
  let windowsVerbatimArguments = false
  if (process.platform === 'win32') {
    const systemDirectory = path.join(process.env.SystemRoot, 'System32')
    const extension = path.extname(normalizedPath).toLowerCase()
    if (extension === '.bat' || extension === '.cmd') {
      // Batch files require cmd.exe. Reject expansion and command syntax even
      // inside quotes, and disable AutoRun and delayed environment expansion.
      // eslint-disable-next-line no-control-regex -- Control characters must not reach cmd.exe.
      if (/[\x00-\x1f"%!&|<>^]/.test(normalizedPath)) {
        throw new Error('Recovery batch script path contains shell syntax')
      }
      command = path.join(systemDirectory, 'cmd.exe')
      args = ['/d', '/v:off', '/s', '/c', `""${normalizedPath}""`]
      windowsVerbatimArguments = true
    } else if (extension === '.ps1') {
      command = path.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      // Windows' default Restricted policy refuses every script. Bypass it for this
      // process only, as the user chose to run this script.
      args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', normalizedPath]
    } else if (extension === '.vbs') {
      command = path.join(systemDirectory, 'cscript.exe')
      args = ['//Nologo', normalizedPath]
    }
  }
  const maxOutputLength = 16_384

  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {
      ...PROCESS_TREE_SPAWN_OPTIONS,
      shell: false,
      // Close stdin so a script that prompts fails instead of waiting forever.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments,
      windowsHide: true
    })

    let timedOut = false

    const timeout = setTimeout(async () => {
      timedOut = true
      // Subprocesses such as a VPN client must not outlive a timed-out run, or
      // they could still be running when the next run starts after the cooldown.
      try {
        await stopProcessTree(child)
      } catch (error) {
        // The run must still end, or no later recovery could start.
        console.error('Could not stop the timed-out IP block recovery script', error)
      }
      reject(new Error(`Recovery script did not finish within ${timeoutMs / 1000} seconds`))
    }, timeoutMs)

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > maxOutputLength) {
        stdout = stdout.slice(-maxOutputLength)
      }
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > maxOutputLength) {
        stderr = stderr.slice(-maxOutputLength)
      }
    })

    child.once('error', (error) => {
      clearTimeout(timeout)
      if (timedOut) {
        return
      }
      reject(error)
    })

    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout)
      if (timedOut) {
        return
      }
      resolve({
        exitCode,
        signal,
        stdout,
        stderr
      })
    })
  })
}

const ipBlockRecoveryScriptCooldownMs = 10_000

/**
 * @param {string} scriptPath
 * @returns {boolean} whether a new run was started
 */
function startIpBlockRecoveryScript(scriptPath) {
  if (ipBlockRecoveryScriptPromise != null) {
    return false
  }

  ipBlockRecoveryScriptPromise = executeIpBlockRecoveryScript(scriptPath)
    .finally(() => {
      setTimeout(() => {
        ipBlockRecoveryScriptPromise = null
      }, ipBlockRecoveryScriptCooldownMs)
    })

  // The execute handler still observes and forwards the rejection. Attaching a
  // handler here prevents a fast spawn failure from becoming unhandled before
  // the renderer has time to invoke it.
  ipBlockRecoveryScriptPromise.catch(() => {})
  return true
}

/**
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {unknown} scriptPath
 * @returns {scriptPath is string}
 */
function isValidIpBlockRecoveryRequest(event, scriptPath) {
  return isOpenTubeXUrl(event.senderFrame?.url) &&
    typeof scriptPath === 'string' &&
    scriptPath.trim().length > 0
}

/**
 * The recovery script run that is in progress or cooling down, if any.
 * Automatic subscription refreshes wait for it to finish.
 */
export function getIpBlockRecoveryScriptRun() {
  return ipBlockRecoveryScriptPromise
}

/**
 * Registers the handlers that choose and run the user's IP block recovery
 * script. A new run starts only once the previous one has cooled down.
 * @param {object} options
 * @param {(settingKey: string, value: unknown) => Promise<unknown>} options.updateSettingFromMain
 */
export function setupIpBlockRecoveryIpc({ updateSettingFromMain }) {
  ipcMain.handle(IpcChannels.CHOOSE_IP_BLOCK_RECOVERY_SCRIPT, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame?.url)) {
      return
    }

    /** @type {import('electron').FileFilter[]} */
    const filters = process.platform === 'win32'
      ? [
          { name: 'Windows Script Files', extensions: ['bat', 'ps1', 'vbs'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      : [
          { name: 'Shell Script Files', extensions: ['sh'] },
          { name: 'All Files', extensions: ['*'] }
        ]

    return await choosePathSetting({
      webContents: event.sender,
      settingId: 'videoIpBlockScriptPath',
      fallbackPath: app.getPath('home'),
      dialogOptions: { properties: ['openFile'], filters },
      updateSettingFromMain
    })
  })

  ipcMain.handle(IpcChannels.START_IP_BLOCK_RECOVERY_SCRIPT, (event, scriptPath) => {
    if (!isValidIpBlockRecoveryRequest(event, scriptPath)) {
      return false
    }

    return startIpBlockRecoveryScript(scriptPath)
  })

  ipcMain.handle(IpcChannels.EXECUTE_IP_BLOCK_RECOVERY_SCRIPT, async (event, scriptPath) => {
    if (
      !isValidIpBlockRecoveryRequest(event, scriptPath)
    ) {
      return
    }

    try {
      startIpBlockRecoveryScript(scriptPath)

      return await ipBlockRecoveryScriptPromise
    } catch (error) {
      console.error('EXECUTE_IP_BLOCK_RECOVERY_SCRIPT failed', error)
      throw new Error('Failed to execute script', { cause: error })
    }
  })

  ipcMain.handle(IpcChannels.WAIT_FOR_IP_BLOCK_RECOVERY_SCRIPT, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame?.url)) {
      return
    }

    try {
      await ipBlockRecoveryScriptPromise
    } catch {
      // Resume subscription fetching after the recovery attempt finishes.
    }
  })
}
