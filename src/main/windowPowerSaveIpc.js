import { IpcChannels } from '../constants.js'

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'on'>,
 *   BrowserWindow: Pick<typeof import('electron').BrowserWindow, 'fromWebContents'>,
 *   powerSaveBlocker: Pick<typeof import('electron').powerSaveBlocker, 'start' | 'stop'>,
 *   isTrustedUrl: (url: string) => boolean
 * }} dependencies
 */
export function registerWindowPowerSaveIpc({ ipcMain, BrowserWindow, powerSaveBlocker, isTrustedUrl }) {
  /** @type {Map<number, number>} */
  const activeBlockers = new Map()

  /** @param {import('electron').BrowserWindow} window */
  function stopForWindow(window) {
    const blockerId = activeBlockers.get(window.id)
    if (typeof blockerId === 'number') {
      powerSaveBlocker.stop(blockerId)
      activeBlockers.delete(window.id)
    }
  }

  ipcMain.on(IpcChannels.STOP_POWER_SAVE_BLOCKER, (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) stopForWindow(window)
  })

  ipcMain.on(IpcChannels.START_POWER_SAVE_BLOCKER, (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !activeBlockers.has(window.id)) {
      const blockerId = powerSaveBlocker.start('prevent-display-sleep')
      activeBlockers.set(window.id, blockerId)
    }
  })

  return { stopForWindow }
}
