import { IpcChannels } from '../constants.js'

/**
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'on'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   getWindows: () => import('electron').BrowserWindow[]
 * }} ToastIpcDependencies
 */

/** @param {ToastIpcDependencies} dependencies */
export function registerToastIpc({ ipcMain, isTrustedUrl, getWindows }) {
  ipcMain.on(IpcChannels.SHOW_TOAST, (event, message, time, icon, buttonAction) => {
    if (
      !isTrustedUrl(event.senderFrame.url) ||
      typeof message !== 'string' ||
      (time !== null && typeof time !== 'number') ||
      (icon != null && (!Array.isArray(icon) || icon.length !== 2 || icon.some(part => typeof part !== 'string'))) ||
      (buttonAction != null && buttonAction !== 'open-sync-settings')
    ) {
      return
    }

    for (const window of getWindows()) {
      if (!window.webContents.isDestroyed() && isTrustedUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SHOW_TOAST, message, time, icon ?? null, buttonAction ?? null)
      }
    }
  })
}
