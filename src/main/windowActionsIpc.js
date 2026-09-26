import { IpcChannels } from '../constants.js'

/**
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle' | 'on'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   BrowserWindow: Pick<typeof import('electron').BrowserWindow, 'fromWebContents'>,
 *   TabManager: typeof import('./tabs/TabManager').TabManager,
 *   appShortcutBlockedWindows: WeakSet<import('electron').BrowserWindow>,
 *   reopenClosedWindow: () => Promise<unknown>,
 *   createWindow: (options: object) => Promise<unknown>,
 *   rootAppUrl: string
 * }} WindowActionsIpcDependencies
 */

/** @param {WindowActionsIpcDependencies} dependencies */
export function registerWindowActionsIpc({
  ipcMain,
  isTrustedUrl,
  BrowserWindow,
  TabManager,
  appShortcutBlockedWindows,
  reopenClosedWindow,
  createWindow,
  rootAppUrl
}) {
  ipcMain.on(IpcChannels.SET_WINDOW_TITLE, (event, payload) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }

    const title = payload?.title
    const tabId = payload?.tabId
    const manager = TabManager.getFromWebContents(event.sender)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null

    if (manager && tab && typeof title === 'string') {
      manager.applyTabTitle(tab, title)
    }
  })

  ipcMain.handle(IpcChannels.TABS_SET_SHORTCUTS_BLOCKED, (event, blocked) => {
    if (!isTrustedUrl(event.senderFrame.url) || typeof blocked !== 'boolean') {
      return
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) return

    if (blocked) {
      appShortcutBlockedWindows.add(browserWindow)
    } else {
      appShortcutBlockedWindows.delete(browserWindow)
    }
  })

  ipcMain.on(IpcChannels.RESTORE_CLOSED_WINDOW, (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow || appShortcutBlockedWindows.has(browserWindow)) return
    reopenClosedWindow()
  })

  ipcMain.on(IpcChannels.CREATE_NEW_WINDOW, (event, path, query, searchQueryText) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }

    if (
      typeof path !== 'string' ||
      (query != null && typeof query !== 'object') ||
      (searchQueryText != null && typeof searchQueryText !== 'string')
    ) {
      return
    }

    if (path.charAt(0) !== '/') {
      path = `/${path}`
    }

    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== null && item !== undefined) {
            searchParams.append(key, String(item))
          }
        }
      } else if (value !== null && value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    const search = searchParams.toString()
    const windowStartupUrl = `${rootAppUrl}#${path}${search.length > 0 ? `?${search}` : ''}`

    createWindow({
      replaceMainWindow: false,
      showWindowNow: true,
      windowStartupUrl,
      searchQueryText
    })
  })

  // Handler for creating new tab from renderer
  ipcMain.on(IpcChannels.CREATE_NEW_TAB, (event, path, query) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }

    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      manager.createTabWithPreference({ route: path, query, makeActive: true }).catch(error => {
        console.error('Failed to create a new tab from the renderer:', error)
      })
    }
  })
}
