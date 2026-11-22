// @ts-check
import { BrowserWindow, powerSaveBlocker } from 'electron'

import { IpcChannels } from '../constants'
import { onTrusted } from './ipc'

/**
 * Keeps the display awake while a window asks for it, for example during playback.
 * @returns {{ stopPowerSaveBlockerForWindow: (window: BrowserWindow) => void }}
 */
export function setupPowerSaveBlockerIpc() {
  /** @type {Map<number, number>} */
  const activePowerSaveBlockers = new Map()

  /**
   * @param {BrowserWindow} window
   */
  function stopPowerSaveBlockerForWindow(window) {
    const powerSaveBlockerId = activePowerSaveBlockers.get(window.id)

    if (typeof powerSaveBlockerId === 'number') {
      powerSaveBlocker.stop(powerSaveBlockerId)

      activePowerSaveBlockers.delete(window.id)
    }
  }

  onTrusted(IpcChannels.STOP_POWER_SAVE_BLOCKER, (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)

    if (browserWindow) {
      stopPowerSaveBlockerForWindow(browserWindow)
    }
  })

  onTrusted(IpcChannels.START_POWER_SAVE_BLOCKER, (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)

    if (browserWindow && !activePowerSaveBlockers.has(browserWindow.id)) {
      const powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')

      activePowerSaveBlockers.set(browserWindow.id, powerSaveBlockerId)
    }
  })

  return { stopPowerSaveBlockerForWindow }
}
