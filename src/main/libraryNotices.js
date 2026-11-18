// @ts-check
import { BrowserWindow, ipcMain } from 'electron'

import { IpcChannels } from '../constants'
import { onLegacyDatastoreChanges, onLegacyDatastoreImported } from '../datastores'
import { isTrustedSender } from './ipc'
import { TabManager } from './tabs/TabManager'

/** @typedef {'olderVersionChanges' | 'libraryFormatChanged'} LibraryNotice */

/**
 * Tells the user when an older version changed the library or its format
 * changed. Datastores open one after another, so each notice shows once per
 * start for all of them. Every window shows it in an app dialog until one of
 * them dismisses it, so a reloaded or closed window doesn't lose it.
 *
 * Must run before any datastore finishes loading.
 */
export function setupLibraryNotices() {
  /** @type {Set<LibraryNotice>} */
  const shownNotices = new Set()
  /** @type {LibraryNotice[]} */
  let pendingNotices = []

  function sendNoticesChanged() {
    for (const window of BrowserWindow.getAllWindows()) {
      TabManager.getForWindow(window.id)?.bridge.send(IpcChannels.LIBRARY_NOTICES_CHANGED)
    }
  }

  /** @param {LibraryNotice} key */
  function showNotice(key) {
    // E2E profiles start from seeded NeDB files, so every test would import
    // them. Only tests that opt in see these notices.
    if (process.env.OPENTUBEX_E2E_USER_DATA_DIR && process.env.OPENTUBEX_E2E_LIBRARY_NOTICES !== 'true') return
    if (shownNotices.has(key)) return
    shownNotices.add(key)
    pendingNotices.push(key)
    // Windows that haven't loaded yet get the notices once they mount.
    sendNoticesChanged()
  }

  /** @param {import('electron').IpcMainEvent | import('electron').IpcMainInvokeEvent} event */
  const isAppWindow = event => isTrustedSender(event) && !!TabManager.getFromWebContents(event.sender)

  ipcMain.handle(IpcChannels.GET_LIBRARY_NOTICES, event => isAppWindow(event) ? pendingNotices : [])

  ipcMain.on(IpcChannels.DISMISS_LIBRARY_NOTICE, (event, key) => {
    if (!isAppWindow(event) || !pendingNotices.includes(key)) return
    pendingNotices = pendingNotices.filter(notice => notice !== key)
    sendNoticesChanged()
  })

  onLegacyDatastoreChanges(change => {
    console.warn('Applied library changes made by an older version', change)
    showNotice('olderVersionChanges')
  })
  onLegacyDatastoreImported(() => showNotice('libraryFormatChanged'))
}
