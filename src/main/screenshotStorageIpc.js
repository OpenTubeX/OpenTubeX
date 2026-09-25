import path from 'node:path'
import { constants as fsConstants } from 'node:fs'
import asyncFs from 'node:fs/promises'
import { IpcChannels, SyncEvents } from '../constants.js'

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'on' | 'handle'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   settings: typeof import('../datastores/handlers/base').settings,
 *   app: Pick<import('electron').App, 'getPath'>,
 *   BrowserWindow: Pick<typeof import('electron').BrowserWindow, 'fromWebContents' | 'getAllWindows'>,
 *   dialog: Pick<typeof import('electron').dialog, 'showOpenDialog'>
 * }} dependencies
 */
export function registerScreenshotStorageIpc({ ipcMain, isTrustedUrl, settings, app, BrowserWindow, dialog }) {
  /**
   * @param {import('electron').WebContents} webContents
   * @param {string | undefined} [currentPath]
   */
  async function chooseDefaultFolder(webContents, currentPath) {
    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('pictures')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    let result

    const window = BrowserWindow.fromWebContents(webContents)
    if (window) {
      result = await dialog.showOpenDialog(window, dialogOptions)
    } else {
      result = await dialog.showOpenDialog(dialogOptions)
    }

    if (result.canceled) {
      return
    }

    const settingId = 'screenshotFolderPath'

    await settings.upsert(settingId, result.filePaths[0])

    const syncPayload = {
      event: SyncEvents.GENERAL.UPSERT,
      data: {
        _id: settingId,
        value: result.filePaths[0]
      }
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      if (isTrustedUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SYNC_SETTINGS, syncPayload)
      }
    })

    return result.filePaths[0]
  }

  ipcMain.on(IpcChannels.CHOOSE_DEFAULT_FOLDER, async (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }

    const currentPath = (await settings._findOne('screenshotFolderPath'))?.value

    await chooseDefaultFolder(event.sender, currentPath)
  })

  ipcMain.handle(IpcChannels.WRITE_TO_DEFAULT_FOLDER, async (event, filename, arrayBuffer) => {
    if (
      !isTrustedUrl(event.senderFrame.url) ||
      typeof filename !== 'string' ||
      !(arrayBuffer instanceof ArrayBuffer)) {
      return
    }

    const folderPath = (await settings._findOne('screenshotFolderPath'))?.value

    let directory
    if (typeof folderPath === 'string' && folderPath.length > 0) {
      try {
        await asyncFs.access(path.normalize(folderPath), fsConstants.W_OK)
        directory = folderPath
      } catch {}
    }

    // if setting is not set or we do not have write access to the folder
    // prompt the user for a folder
    // not having write access can happen if the user copies their settings to different machines
    // or if they revoke a previously permitted folder in flatseal
    if (directory === undefined) {
      directory = await chooseDefaultFolder(event.sender)

      if (typeof directory !== 'string' || directory.length === 0) {
        return false
      }
    }

    directory = path.normalize(directory)

    const filePath = path.resolve(directory, filename)

    // Ensure that we are only writing inside of the expected directory
    // 'path.dirname' does not return trailing slash, remove it from 'directory' path to ensure consistent comparison
    if (path.dirname(filePath) !== directory.replace(/\/$/, '')) {
      throw new Error('Invalid save location')
    }

    try {
      await asyncFs.mkdir(directory, { recursive: true })

      await asyncFs.writeFile(filePath, new DataView(arrayBuffer))
    } catch (error) {
      console.error('WRITE_TO_DEFAULT_FOLDER failed', error)
      // throw a new error so that we don't expose the real error to the renderer
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Failed to save')
    }

    return true
  })
}
