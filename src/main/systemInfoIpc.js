import { IpcChannels } from '../constants.js'

/**
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   app: Pick<import('electron').App, 'getSystemLocale'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   hostname: () => string,
 *   release: () => string,
 *   getLinuxDistributionInfo: () => Promise<{ platform?: string, release?: string } | null>,
 *   getFonts: (options: { disableQuoting: boolean }) => Promise<unknown[]>,
 *   platform: NodeJS.Platform,
 *   architecture: string,
 *   isWaylandPlatform: boolean,
 *   supportsAutoPictureInPictureMinimize: Promise<boolean>
 * }} SystemInfoIpcDependencies
 */

/** @param {SystemInfoIpcDependencies} dependencies */
export function registerSystemInfoIpc({
  ipcMain, app, isTrustedUrl, hostname, release, getLinuxDistributionInfo, getFonts,
  platform, architecture, isWaylandPlatform, supportsAutoPictureInPictureMinimize
}) {
  ipcMain.handle(IpcChannels.GET_DEVICE_NAME, (event) => {
    if (isTrustedUrl(event.senderFrame.url)) {
      return hostname()
    }
  })

  ipcMain.handle(IpcChannels.GET_DEVICE_INFO, async (event) => {
    if (isTrustedUrl(event.senderFrame.url)) {
      const linuxDistribution = platform === 'linux'
        ? await getLinuxDistributionInfo()
        : null
      return {
        platform: linuxDistribution?.platform || platform,
        architecture: architecture,
        release: linuxDistribution?.release || release(),
      }
    }
  })

  ipcMain.handle(IpcChannels.GET_SYSTEM_LOCALE, (event) => {
    if (isTrustedUrl(event.senderFrame.url)) {
      // we should switch to getPreferredSystemLanguages at some point and iterate through until we find a supported locale
      return app.getSystemLocale()
    }
  })

  ipcMain.handle(IpcChannels.GET_SYSTEM_FONTS, async (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) return []

    const fonts = await getFonts({ disableQuoting: true })
    return [...new Set(fonts
      .filter(font => typeof font === 'string')
      .map(font => font.trim())
      .filter(Boolean))]
  })

  ipcMain.handle(IpcChannels.IS_WAYLAND_PLATFORM, (event) => {
    if (isTrustedUrl(event.senderFrame.url)) {
      return isWaylandPlatform
    }
  })

  ipcMain.handle(IpcChannels.SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE, async (event) => {
    if (isTrustedUrl(event.senderFrame.url)) {
      return supportsAutoPictureInPictureMinimize
    }
  })
}
