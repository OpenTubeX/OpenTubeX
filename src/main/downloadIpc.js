import { IpcChannels } from '../constants.js'

export const DOWNLOAD_HANDLERS = {
  controlDownload: IpcChannels.YT_DLP_CONTROL_DOWNLOAD,
  queueAction: IpcChannels.YT_DLP_QUEUE_ACTION,
  listDownloads: IpcChannels.YT_DLP_LIST_DOWNLOADS,
  clearDownloads: IpcChannels.YT_DLP_CLEAR_DOWNLOADS,
  openDownload: IpcChannels.YT_DLP_OPEN_DOWNLOAD,
  removeDownload: IpcChannels.YT_DLP_REMOVE_DOWNLOAD,
  getInfo: IpcChannels.YT_DLP_GET_INFO,
  getSubtitle: IpcChannels.YT_DLP_GET_SUBTITLE,
  cancelHistoryRepair: IpcChannels.YT_DLP_CANCEL_HISTORY_REPAIR,
  getHistoryMetadata: IpcChannels.YT_DLP_GET_HISTORY_METADATA,
  getPlaybackInfo: IpcChannels.YT_DLP_GET_PLAYBACK_INFO,
  getRecommendations: IpcChannels.YT_DLP_GET_RECOMMENDATIONS,
  playbackCacheGet: IpcChannels.YT_DLP_PLAYBACK_CACHE_GET,
  playbackCacheSet: IpcChannels.YT_DLP_PLAYBACK_CACHE_SET,
  playbackCacheDelete: IpcChannels.YT_DLP_PLAYBACK_CACHE_DELETE,
  playbackCacheClear: IpcChannels.YT_DLP_PLAYBACK_CACHE_CLEAR,
  checkBinaryUpdate: IpcChannels.YT_DLP_CHECK_BINARY_UPDATE,
  downloadBinary: IpcChannels.YT_DLP_DOWNLOAD_BINARY
}

/**
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle' | 'on'>,
 *   download: (event: import('electron').IpcMainInvokeEvent, payload: unknown, retryDownloadId: unknown, automaticDownloadAuthorized: boolean) => unknown,
 *   cancelDownload: (...args: unknown[]) => unknown,
 *   handlers: Record<keyof typeof DOWNLOAD_HANDLERS, (...args: unknown[]) => unknown>,
 *   isAutomaticDownloadAuthorized: (event: import('electron').IpcMainInvokeEvent, payload: unknown) => boolean
 * }} DownloadIpcDependencies
 */

/** @param {DownloadIpcDependencies} dependencies */
export function registerDownloadIpc({ ipcMain, download, cancelDownload, handlers, isAutomaticDownloadAuthorized }) {
  ipcMain.handle(IpcChannels.YT_DLP_DOWNLOAD, (event, payload, retryDownloadId) => (
    download(event, payload, retryDownloadId, isAutomaticDownloadAuthorized(event, payload))
  ))
  ipcMain.on(IpcChannels.YT_DLP_CANCEL_DOWNLOAD, cancelDownload)

  for (const [name, channel] of Object.entries(DOWNLOAD_HANDLERS)) {
    const handler = handlers[name]
    ipcMain.handle(channel, handler)
  }
}
