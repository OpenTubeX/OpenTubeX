import { IpcChannels } from '../constants.js'

/**
 * @typedef {{ enabled: boolean, path: string }} RuntimeFlag
 */

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle' | 'once'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   replaceHttpCache: RuntimeFlag,
 *   disableHardwareAcceleration: RuntimeFlag,
 *   files: Pick<typeof import('node:fs/promises'), 'open' | 'rm'>,
 *   relaunch: () => void
 * }} dependencies
 */
export function registerRuntimeFlagsIpc({ ipcMain, isTrustedUrl, replaceHttpCache, disableHardwareAcceleration, files, relaunch }) {
  const flags = [
    [IpcChannels.GET_REPLACE_HTTP_CACHE, IpcChannels.TOGGLE_REPLACE_HTTP_CACHE, replaceHttpCache],
    [IpcChannels.GET_DISABLE_HARDWARE_ACCELERATION, IpcChannels.TOGGLE_DISABLE_HARDWARE_ACCELERATION, disableHardwareAcceleration]
  ]

  for (const [getChannel, toggleChannel, flag] of flags) {
    ipcMain.handle(getChannel, event => {
      if (isTrustedUrl(event.senderFrame.url)) return flag.enabled
    })

    ipcMain.once(toggleChannel, async event => {
      if (!isTrustedUrl(event.senderFrame.url)) return

      if (flag.enabled) {
        await files.rm(flag.path)
      } else {
        const handle = await files.open(flag.path, 'w')
        await handle.close()
      }
      relaunch()
    })
  }
}
