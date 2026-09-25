import { IpcChannels } from '../constants.js'

/** @param {Pick<import('electron').Session, 'setProxy' | 'closeAllConnections'>} session */
export function createProxyController(session) {
  /** @type {string | undefined} */
  let url

  return {
    getUrl: () => url,
    /** @param {string} nextUrl @param {{ closeConnections?: boolean }} [options] */
    set(nextUrl, { closeConnections = true } = {}) {
      session.setProxy({ proxyRules: nextUrl })
      url = nextUrl
      if (closeConnections) session.closeAllConnections()
    },
    clear() {
      session.setProxy({})
      url = undefined
      session.closeAllConnections()
    }
  }
}

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'on'>,
 *   controller: ReturnType<typeof createProxyController>,
 *   isTrustedUrl: (url: string) => boolean
 * }} dependencies
 */
export function registerProxyIpc({ ipcMain, controller, isTrustedUrl }) {
  ipcMain.on(IpcChannels.ENABLE_PROXY, (event, url) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    controller.set(url)
  })

  ipcMain.on(IpcChannels.DISABLE_PROXY, (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    controller.clear()
  })
}
