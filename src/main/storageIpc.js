import { IpcChannels } from '../constants.js'

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   getStorageUsage: () => Promise<Record<string, number | null>>,
 *   clearStorage: (category: string) => Promise<boolean>,
 *   compactStorageDatabases: () => Promise<boolean>
 * }} dependencies
 */
export function registerStorageIpc({ ipcMain, isTrustedUrl, getStorageUsage, clearStorage, compactStorageDatabases }) {
  ipcMain.handle(IpcChannels.STORAGE_GET_USAGE, async (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return {}
    return getStorageUsage()
  })

  ipcMain.handle(IpcChannels.STORAGE_CLEAR, async (event, category) => {
    if (!isTrustedUrl(event.senderFrame.url) || !event.sender.isFocused()) return false
    return clearStorage(category)
  })

  ipcMain.handle(IpcChannels.STORAGE_COMPACT_DATABASES, async (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return false
    return compactStorageDatabases()
  })
}
