import { IpcChannels } from '../constants.js'

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'on'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   isInvidiousInstanceUrl: (url: string, instanceUrl: string) => boolean
 * }} dependencies
 */
export function registerInvidiousAuthorizationIpc({ ipcMain, isTrustedUrl, isInvidiousInstanceUrl }) {
  /** @type {Map<number, { url: string, authorization: string }>} */
  const authorizations = new Map()

  ipcMain.on(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, (event, authorization, url) => {
    if (!isTrustedUrl(event.senderFrame.url)) return

    if (!authorization) {
      authorizations.delete(event.sender.id)
    } else if (typeof authorization === 'string' && typeof url === 'string') {
      authorizations.set(event.sender.id, { authorization, url })
    }
  })

  return {
    /** @param {number} webContentsId @param {string} url */
    getForRequest(webContentsId, url) {
      const entry = authorizations.get(webContentsId)
      return entry && isInvidiousInstanceUrl(url, entry.url) ? entry.authorization : undefined
    },
    /** @param {number} webContentsId */
    forget(webContentsId) {
      authorizations.delete(webContentsId)
    }
  }
}
