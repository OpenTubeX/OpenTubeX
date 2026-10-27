import { BrowserWindow, ipcMain } from 'electron'

import { isOpenTubeXUrl } from './utils'

/**
 * Whether an IPC message comes from an OpenTubeX page. A frame that has
 * navigated away or been destroyed since sending it does not qualify.
 * @param {{ senderFrame: import('electron').WebFrameMain | null }} event
 * @returns {boolean}
 */
export function isTrustedSender(event) {
  const url = event.senderFrame?.url
  return typeof url === 'string' && isOpenTubeXUrl(url)
}

/**
 * Registers an invoke handler that only OpenTubeX pages may call.
 * Arguments come from the renderer, so handlers must validate them.
 * @template Result
 * @template [Untrusted=undefined]
 * @param {string} channel
 * @param {(event: import('electron').IpcMainInvokeEvent, ...args: unknown[]) => Result} handler
 * @param {Untrusted} [untrustedResult] What other senders receive
 */
export function handleTrusted(channel, handler, untrustedResult) {
  ipcMain.handle(channel, (event, ...args) => isTrustedSender(event)
    ? handler(event, ...args)
    : untrustedResult)
}

/**
 * Registers a listener for messages that only OpenTubeX pages may send.
 * Arguments come from the renderer, so listeners must validate them.
 * @param {string} channel
 * @param {(event: import('electron').IpcMainEvent, ...args: unknown[]) => void} listener
 */
export function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrustedSender(event)) listener(event, ...args)
  })
}

/**
 * Sends a message to every window that shows OpenTubeX. A window that closes
 * meanwhile doesn't keep the others from receiving it.
 * @param {string} channel
 * @param {...unknown} args
 */
export function sendToAppWindows(channel, ...args) {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (window.isDestroyed() || window.webContents.isDestroyed() || !isOpenTubeXUrl(window.webContents.getURL())) continue
      window.webContents.send(channel, ...args)
    } catch (error) {
      console.warn(`Could not send ${channel} to a window`, error)
    }
  }
}
