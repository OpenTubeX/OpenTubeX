import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { IpcChannels } from '../constants.js'

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   directory: string,
 *   isTrustedUrl: (url: string) => boolean
 * }} dependencies
 */
export function registerPlayerCacheIpc({ ipcMain, directory, isTrustedUrl }) {
  /** @param {unknown} key */
  function pathForKey(key) {
    // Preserve the existing key format while preventing access outside the cache directory.
    const sanitizedKey = `${key}`.replaceAll(/[./\\]/g, '__')
    return join(directory, sanitizedKey)
  }

  ipcMain.handle(IpcChannels.PLAYER_CACHE_GET, async (event, key) => {
    if (!isTrustedUrl(event.senderFrame.url)) return

    try {
      const contents = await readFile(pathForKey(key))
      return contents.buffer
    } catch (error) {
      // A missing player file is expected when YouTube changes its JavaScript.
      if (error.code !== 'ENOENT') console.error(error)
      return undefined
    }
  })

  ipcMain.handle(IpcChannels.PLAYER_CACHE_SET, async (event, key, value) => {
    if (!isTrustedUrl(event.senderFrame.url)) return

    const filePath = pathForKey(key)
    await mkdir(directory, { recursive: true })
    await writeFile(filePath, new Uint8Array(value))
  })
}
