import { BrowserWindow, dialog } from 'electron'

import { settings } from '../datastores/handlers/base'

/**
 * Shows a native picker and saves the chosen path to the setting. The
 * renderer cannot write these settings itself (see settingWriteGuard.js).
 * @param {object} options
 * @param {import('electron').WebContents} options.webContents
 * @param {string} options.settingId
 * @param {string} options.fallbackPath
 * @param {import('electron').OpenDialogOptions} options.dialogOptions
 * @param {(settingKey: string, value: unknown) => Promise<unknown>} options.updateSettingFromMain
 * @returns {Promise<string | undefined>}
 */
export async function choosePathSetting({ webContents, settingId, fallbackPath, dialogOptions, updateSettingFromMain }) {
  const currentPath = (await settings._findOne(settingId))?.value
  const options = { ...dialogOptions, defaultPath: typeof currentPath === 'string' && currentPath !== '' ? currentPath : fallbackPath }
  const window = BrowserWindow.fromWebContents(webContents)
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return undefined
  }

  await updateSettingFromMain(settingId, result.filePaths[0])
  return result.filePaths[0]
}
