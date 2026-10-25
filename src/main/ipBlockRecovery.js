import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import cp from 'child_process'
import asyncFs from 'fs/promises'

import { IpcChannels } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { isOpenTubeXUrl } from './utils'

/** @type {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }> | null} */
let ipBlockRecoveryScriptPromise = null

/**
 * @param {import('electron').WebContents} webContents
 * @param {string | undefined} [currentPath]
 * @returns {Promise<string | undefined>}
 */
async function chooseIpBlockRecoveryScript(webContents, currentPath) {
  if (typeof currentPath !== 'string' || currentPath.length === 0) {
    currentPath = app.getPath('home')
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

  const dialogOptions = {
    defaultPath: currentPath,
    properties: ['openFile'],
    filters
  }

  const window = BrowserWindow.fromWebContents(webContents)
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return undefined
  }

  return result.filePaths[0]
}

/**
 * @param {string} scriptPath
 * @returns {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>}
 */
async function executeIpBlockRecoveryScript(scriptPath) {
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
      args = ['-NoProfile', '-NonInteractive', '-File', normalizedPath]
    } else if (extension === '.vbs') {
      command = path.join(systemDirectory, 'cscript.exe')
      args = ['//Nologo', normalizedPath]
    }
  }
  const maxOutputLength = 16_384

  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {
      shell: false,
      windowsVerbatimArguments,
      windowsHide: true
    })

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
      reject(error)
    })

    child.once('close', (exitCode, signal) => {
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
  return isOpenTubeXUrl(event.senderFrame.url) &&
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
 */
export function setupIpBlockRecoveryIpc() {
  ipcMain.handle(IpcChannels.CHOOSE_IP_BLOCK_RECOVERY_SCRIPT, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    return await chooseIpBlockRecoveryScript(event.sender, currentPath)
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
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      await ipBlockRecoveryScriptPromise
    } catch {
      // Resume subscription fetching after the recovery attempt finishes.
    }
  })
}
