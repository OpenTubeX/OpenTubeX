// @ts-check
import { app, BrowserWindow, dialog } from 'electron'

import { IpcChannels } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { handleTrusted } from './ipc'

/**
 * @param {object} options
 * @param {(request: { sections: string[], settings?: object }) => Promise<unknown>} options.createBackupArchive
 * @param {(settingKey: string, value: unknown) => Promise<unknown>} options.updateSettingFromMain
 * @param {() => void} options.checkScheduledBackup
 */
export function setupBackupIpc({ createBackupArchive, updateSettingFromMain, checkScheduledBackup }) {
  handleTrusted(IpcChannels.CREATE_BACKUP_ARCHIVE, async (_event, sections, settings) => {
    if (!Array.isArray(sections) || sections.some(section => typeof section !== 'string') ||
      (settings !== undefined && (settings === null || typeof settings !== 'object' || Array.isArray(settings)))) {
      throw new TypeError('Invalid backup sections or settings')
    }
    return createBackupArchive({ sections, settings })
  }, null)

  handleTrusted(IpcChannels.CHOOSE_SCHEDULED_BACKUP_FOLDER, async (event) => {
    const currentPath = (await baseHandlers.settings._findOne('scheduledBackupFolderPath'))?.value
    /** @type {import('electron').OpenDialogOptions} */
    const options = { defaultPath: currentPath || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    if (result.canceled || !result.filePaths[0]) return
    await updateSettingFromMain('scheduledBackupFolderPath', result.filePaths[0])
    checkScheduledBackup()
    return result.filePaths[0]
  })
}
