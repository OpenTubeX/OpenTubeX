import { IpcChannels } from '../constants.js'

/**
 * @typedef {'executable' | 'cookies' | 'browserProfile' | 'downloadFolder'} YtDlpFileChoice
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   app: Pick<import('electron').App, 'getPath'>,
 *   BrowserWindow: Pick<typeof import('electron').BrowserWindow, 'fromWebContents'>,
 *   dialog: Pick<typeof import('electron').dialog, 'showOpenDialog'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   platform: NodeJS.Platform
 * }} YtDlpFileDialogDependencies
 */

/** @param {YtDlpFileDialogDependencies} dependencies */
export function registerYtDlpFileDialogs({ ipcMain, app, BrowserWindow, dialog, isTrustedUrl, platform }) {
  /** @type {Record<YtDlpFileChoice, { channel: string, defaultPath: 'home' | 'downloads', properties: 'openFile' | 'openDirectory', filters?: import('electron').FileFilter[] }>} */
  const choices = {
    executable: {
      channel: IpcChannels.YT_DLP_CHOOSE_EXECUTABLE,
      defaultPath: 'home',
      properties: 'openFile',
      filters: platform === 'win32'
        ? [
            { name: 'Executable Files', extensions: ['exe'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        : [{ name: 'All Files', extensions: ['*'] }]
    },
    cookies: {
      channel: IpcChannels.YT_DLP_CHOOSE_COOKIES,
      defaultPath: 'home',
      properties: 'openFile',
      filters: [
        { name: 'Cookie Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    },
    browserProfile: {
      channel: IpcChannels.YT_DLP_CHOOSE_BROWSER_PROFILE,
      defaultPath: 'home',
      properties: 'openDirectory'
    },
    downloadFolder: {
      channel: IpcChannels.YT_DLP_CHOOSE_DOWNLOAD_FOLDER,
      defaultPath: 'downloads',
      properties: 'openDirectory'
    }
  }

  for (const choice of Object.values(choices)) {
    ipcMain.handle(choice.channel, async (event, currentPath) => {
      if (
        !isTrustedUrl(event.senderFrame.url) ||
        (currentPath != null && typeof currentPath !== 'string')
      ) {
        return
      }

      if (typeof currentPath !== 'string' || currentPath.length === 0) {
        currentPath = app.getPath(choice.defaultPath)
      }

      const dialogOptions = {
        defaultPath: currentPath,
        properties: [choice.properties],
        ...(choice.filters && { filters: choice.filters })
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return undefined
      }

      return result.filePaths[0]
    })
  }
}
