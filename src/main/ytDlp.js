/** @typedef {import('./ytDlpBinaries').YtDlpBinaryInfo} YtDlpBinaryInfo */
/** @typedef {import('./ytDlpBinaries').YtDlpInfo} YtDlpInfo */
/** @typedef {import('./ytDlpDownloads').YtDlpDownloadPayload} YtDlpDownloadPayload */
/** @typedef {import('./ytDlpDownloads').YtDlpDownloadStatus} YtDlpDownloadStatus */
/** @typedef {import('./ytDlpPlayback').YtDlpPlaybackFormat} YtDlpPlaybackFormat */
/** @typedef {import('./ytDlpPlayback').YtDlpPlaybackCaption} YtDlpPlaybackCaption */
/** @typedef {import('./ytDlpPlayback').YtDlpPlaybackInfo} YtDlpPlaybackInfo */
/** @typedef {import('./ytDlpPlayback').YtDlpRecommendation} YtDlpRecommendation */

export {
  getYtDlpExternalStreamCookieHeader,
  getYtDlpExternalStreamHeaders,
  isYtDlpHttpStoryboardUrl,
  isYtDlpStoryboardUrl,
} from './ytDlpExternalStreams'
export {
  getDlnaFfmpegExecutable,
  handleYtDlpCheckBinaryUpdate,
  handleYtDlpDownloadBinary,
  handleYtDlpGetInfo,
  parseYtDlpSupportedBrowsers,
} from './ytDlpBinaries'
export {
  handleYtDlpCancelHistoryRepair,
  handleYtDlpGetHistoryMetadata,
  handleYtDlpGetPlaybackInfo,
  handleYtDlpGetRecommendations,
  handleYtDlpGetSubtitle,
  handleYtDlpSearch,
} from './ytDlpPlayback'
export {
  flushYtDlpDownloadRecords,
  getYtDlpDownloadFile,
  handleYtDlpCancelDownload,
  handleYtDlpClearDownloads,
  handleYtDlpControlDownload,
  handleYtDlpDownload,
  handleYtDlpListDownloads,
  handleYtDlpOpenDownload,
  handleYtDlpQueueAction,
  handleYtDlpRemoveDownload,
  refreshYtDlpDownloadQueue,
  restoreYtDlpDownloadQueue,
  shutdownYtDlpDownloads,
} from './ytDlpDownloads'
