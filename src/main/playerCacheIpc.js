import asyncFs from 'node:fs/promises'
import path from 'node:path'

import { IpcChannels } from '../constants'
import { handleTrusted } from './ipc'

/**
 * Stores YouTube's player JavaScript, so it is downloaded only when it changes.
 * @param {string} directory
 */
export function setupPlayerCacheIpc(directory) {
  function playerCachePathForKey(key) {
    // Remove path separators and period characters,
    // to prevent any files outside of the player_cache directory,
    // from being read or written
    const sanitizedKey = `${key}`.replaceAll(/[./\\]/g, '__')

    return path.join(directory, sanitizedKey)
  }

  handleTrusted(IpcChannels.PLAYER_CACHE_GET, async (_event, key) => {
    const filePath = playerCachePathForKey(key)

    try {
      const contents = await asyncFs.readFile(filePath)

      return contents.buffer
    } catch (e) {
      // Don't log the error if the file doesn't exist as we'll just fetch it from YouTube
      // this usually happens when YouTube updates their player JavaScript
      if (e.code !== 'ENOENT') {
        console.error(e)
      }

      return undefined
    }
  })

  handleTrusted(IpcChannels.PLAYER_CACHE_SET, async (_event, key, value) => {
    const filePath = playerCachePathForKey(key)

    await asyncFs.mkdir(directory, { recursive: true })

    await asyncFs.writeFile(filePath, new Uint8Array(value))
  })
}
