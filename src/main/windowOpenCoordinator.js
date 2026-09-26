import { IpcChannels } from '../constants.js'

/**
 * @typedef {{url: string, tabId: string | null}} PendingOpenUrl
 * @typedef {{
 *   rootAppUrl: string,
 *   getDirectOpenUrl: (url: string | null | undefined) => string | null,
 *   isTrustedUrl: (url: string) => boolean,
 *   BrowserWindow: Pick<typeof import('electron').BrowserWindow, 'fromWebContents'>,
 *   TabManager: typeof import('./tabs/TabManager').TabManager
 * }} WindowOpenDependencies
 */

/** @param {WindowOpenDependencies} dependencies */
export function createWindowOpenCoordinator({ rootAppUrl, getDirectOpenUrl, isTrustedUrl, BrowserWindow, TabManager }) {
  /** @type {Map<number, PendingOpenUrl[]>} */
  const pendingOpenUrlsByWebContentsId = new Map()
  const openUrlReadyWebContentsIds = new Set()

  /**
   * @param {import('electron').BrowserWindow | undefined | null} browserWindow
   * @param {string | null | undefined} url
   * @param {{ reuseEmptyRootTab?: boolean }} [options]
   */
  function openUrlInWindow(browserWindow, url, options = {}) {
    if (!browserWindow || browserWindow.isDestroyed() || !url) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    if (tabManager) {
      openUrlInTab(tabManager, url, options).catch(error => {
        console.error('Failed to open URL in a tab:', error)
      })
      return
    }

    sendOpenUrlToWebContents(browserWindow.webContents, url)
  }

  /**
   * @param {TabManager} tabManager
   * @param {string} url
   * @param {{ reuseEmptyRootTab?: boolean }} options
   */
  async function openUrlInTab(tabManager, url, options) {
    const directOpenUrl = getDirectOpenUrl(url)
    if (directOpenUrl) {
      await tabManager.createTabWithPreference({
        url: directOpenUrl,
        makeActive: true
      })
      return
    }

    let tab = options.reuseEmptyRootTab ? getReusableOpenUrlTab(tabManager) : null

    if (!tab) {
      tab = await tabManager.createTabWithPreference({
        url: rootAppUrl,
        makeActive: true
      })
    }

    sendOpenUrlToWebContents(tabManager.browserWindow.webContents, url, tab.id)
  }

  /**
   * @param {TabManager} tabManager
   * @returns {import('./tabs/TabManager').TabInfo | null}
   */
  function getReusableOpenUrlTab(tabManager) {
    if (tabManager.tabs.size !== 1 || !tabManager.activeTabId) {
      return null
    }

    const activeTab = tabManager.tabs.get(tabManager.activeTabId)
    return activeTab && TabManager.getOpenTubeXRoute(activeTab.url) === '/'
      ? activeTab
      : null
  }

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string} url
   * @param {string | null} [tabId]
   * @returns {boolean}
   */
  function sendOpenUrlToWebContents(webContents, url, tabId = null) {
    const payload = { url, tabId }
    if (
      !webContents.isDestroyed() &&
      openUrlReadyWebContentsIds.has(webContents.id) &&
      isTrustedUrl(webContents.getURL())
    ) {
      webContents.send(IpcChannels.OPEN_URL, payload)
      return true
    }

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(webContents.id) ?? []
    pendingOpenUrls.push(payload)
    // Protocol activations are user-driven, but keep the startup queue bounded
    // in case a desktop environment repeatedly delivers the same URL.
    if (pendingOpenUrls.length > 20) {
      pendingOpenUrls.shift()
    }
    pendingOpenUrlsByWebContentsId.set(webContents.id, pendingOpenUrls)
    return false
  }

  /**
   * @param {import('electron').IpcMainEvent} event
   */
  function openPendingUrlForReadyWebContents(event) {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }

    openUrlReadyWebContentsIds.add(event.sender.id)

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(event.sender.id)
    if (!pendingOpenUrls || !BrowserWindow.fromWebContents(event.sender)) {
      return
    }

    pendingOpenUrlsByWebContentsId.delete(event.sender.id)
    for (const pendingOpenUrl of pendingOpenUrls) {
      event.reply(IpcChannels.OPEN_URL, pendingOpenUrl)
    }
  }

  return {
    openUrlInWindow,
    openPendingUrlForReadyWebContents,
    resetReady: webContentsId => openUrlReadyWebContentsIds.delete(webContentsId),
    forget: webContentsId => {
      pendingOpenUrlsByWebContentsId.delete(webContentsId)
      openUrlReadyWebContentsIds.delete(webContentsId)
    }
  }
}
