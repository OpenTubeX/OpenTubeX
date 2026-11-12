import { app, BrowserWindow, dialog } from 'electron'
import { constants as fsConstants } from 'node:fs'
import asyncFs from 'node:fs/promises'
import path from 'node:path'

import { IpcChannels, SyncEvents } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { handleTrusted, onTrusted, sendToAppWindows } from './ipc'

/**
 * @param {import('electron').WebContents} webContents
 * @param {string | undefined} [currentPath]
 */
async function chooseScreenshotFolder(webContents, currentPath) {
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

  await baseHandlers.settings.upsert(settingId, result.filePaths[0])

  sendToAppWindows(IpcChannels.SYNC_SETTINGS, {
    event: SyncEvents.GENERAL.UPSERT,
    data: {
      _id: settingId,
      value: result.filePaths[0]
    }
  })

  return result.filePaths[0]
}

/** Lets windows pick the screenshot folder and save screenshots into it. */
export function setupScreenshotFolderIpc() {
  onTrusted(IpcChannels.CHOOSE_DEFAULT_FOLDER, async (event) => {
    const currentPath = (await baseHandlers.settings._findOne('screenshotFolderPath'))?.value

    await chooseScreenshotFolder(event.sender, currentPath)
  })

  handleTrusted(IpcChannels.WRITE_TO_DEFAULT_FOLDER, async (event, filename, arrayBuffer) => {
    if (typeof filename !== 'string' || !(arrayBuffer instanceof ArrayBuffer)) {
      return
    }

    const folderPath = (await baseHandlers.settings._findOne('screenshotFolderPath'))?.value

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
      directory = await chooseScreenshotFolder(event.sender)

      if (typeof directory !== 'string' || directory.length === 0) {
        return false
      }
    }

    directory = path.normalize(directory)

    const filePath = path.resolve(directory, filename)

    // Ensure that we are only writing inside of the expected directory.
    // 'path.resolve' drops trailing separators except for a root folder, like 'path.dirname'.
    if (path.dirname(filePath) !== path.resolve(directory)) {
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
