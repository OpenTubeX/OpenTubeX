import { DOWNLOADED_MEDIA_MIME_TYPES } from '../../../constants'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'

export const watchDownloadPlaybackMethods = {
  /**
   * Keeps the normal online metadata while replacing its streaming formats
   * with a completed file selected from the Downloads page.
   */
  applyDownloadedPlaybackSource: function (downloadId = Number(this.tabRoute.query.downloadId)) {
    if (!Number.isInteger(downloadId)) return false

    const download = this.$store.getters.getYtDlpDownloads[downloadId]
    const file = (download?.status === 'completed' || (process.env.IS_CAPACITOR && download?.status === 'failed')) && ['video', 'audio'].includes(download.mode)
      ? download.files?.find(file => file.videoId === this.videoId && file.available !== false)
      : null
    if (!file) return false

    const extension = file.extension ?? file.path.split('.').at(-1)?.toLowerCase() ?? ''
    const mimeType = download.mode === 'audio' && extension === 'webm'
      ? 'audio/webm'
      : download.mode === 'audio' && extension === 'mp4'
        ? 'audio/mp4'
        : DOWNLOADED_MEDIA_MIME_TYPES[extension]
    if (mimeType === undefined) return false

    this.cacheOnlinePlaybackSource()
    this.sabrData = null
    // Android uses the native player, which reads content URIs directly.
    const url = process.env.IS_CAPACITOR ? file.path : `downloadmedia://file/${downloadId}/${this.videoId}`
    if (download.mode === 'audio') {
      this.manifestSrc = url
      this.manifestMimeType = mimeType
      this.legacyFormats = []
      this.activeFormat = 'audio'
    } else {
      const hasDimensions = Number.isInteger(file.width) && Number.isInteger(file.height)
      this.manifestSrc = null
      this.legacyFormats = [{
        itag: 0,
        qualityLabel: hasDimensions
          ? `${file.width}×${file.height} • ${this.t('Downloads.Local File')}`
          : this.t('Downloads.Local File'),
        fps: null,
        bitrate: 0,
        mimeType,
        height: file.height ?? 0,
        width: file.width ?? 0,
        localFile: true,
        localFileLabel: this.t('Downloads.Local File'),
        url
      }]
      this.activeFormat = 'legacy'
    }
    if (Number.isFinite(file.duration) && file.duration > 0) {
      this.videoLengthSeconds = file.duration
    }
    this.thumbnail = download.thumbnail || this.thumbnail
    if (this.errorMessage) {
      const fileName = file.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, '') ?? this.videoId
      this.videoTitle = file.title || (download.videoId === this.videoId ? download.title : '') || fileName
      this.hasResolvedVideoTitle = true
      this.errorMessage = null
      this.isLoading = false
      this.updateTitle()
    }
    this.streamingDataExpiryDate = null
    this.activePlaybackEngine = 'built-in'
    this.activePlaybackEngineVersion = null
    this.localFilePlayback = true
    this.localPlaybackDownloadId = downloadId
    this.playbackSourceKey++
    return file
  },

  cacheOnlinePlaybackSource: function () {
    if (
      this.localFilePlayback ||
        (this.manifestSrc === null && this.legacyFormats.length === 0)
    ) return

    this.onlinePlaybackSource = {
      manifestSrc: this.manifestSrc,
      manifestMimeType: this.manifestMimeType,
      sabrData: this.sabrData,
      legacyFormats: this.legacyFormats,
      streamingDataExpiryDate: this.streamingDataExpiryDate,
      activeFormat: this.activeFormat,
      activePlaybackEngine: this.activePlaybackEngine,
      activePlaybackEngineVersion: this.activePlaybackEngineVersion,
      hasBeenLoaded: this.sabrPlaybackLoaded
    }
  },

  restoreOnlinePlaybackSource: function () {
    const source = this.onlinePlaybackSource
    if (
      source === null ||
        (source.manifestSrc === null && source.legacyFormats.length === 0) ||
        (
          source.streamingDataExpiryDate !== null &&
          new Date() > source.streamingDataExpiryDate
        )
    ) return false

    this.manifestSrc = source.manifestSrc
    this.manifestMimeType = source.manifestMimeType
    this.sabrData = source.sabrData
    this.legacyFormats = source.legacyFormats
    this.streamingDataExpiryDate = source.streamingDataExpiryDate
    this.activeFormat = source.manifestMimeType === MANIFEST_TYPE_SABR &&
        !source.hasBeenLoaded && source.legacyFormats.length > 0
      ? 'legacy'
      : source.activeFormat
    this.activePlaybackEngine = source.activePlaybackEngine
    this.activePlaybackEngineVersion = source.activePlaybackEngineVersion
    this.localFilePlayback = false
    this.localPlaybackDownloadId = null
    this.playbackSourceKey++
    return true
  },

  playbackSourceRouteBase: function (fullPath) {
    const url = new URL(fullPath, 'https://opentubex.invalid')
    url.searchParams.delete('downloadId')
    return `${url.pathname}${url.search}${url.hash}`
  },

  watchRouteWithoutTimestamp: function (fullPath) {
    const url = new URL(fullPath, 'https://opentubex.invalid')
    url.searchParams.delete('timestamp')
    return `${url.pathname}${url.search}${url.hash}`
  },

  replacePlaybackSourceRoute: async function (downloadId = null) {
    const query = { ...this.tabRoute.query }
    if (downloadId === null) {
      delete query.downloadId
    } else {
      query.downloadId = String(downloadId)
    }

    const location = { path: this.tabRoute.path, query }
    const fullPath = this.tabRouter.resolve(location).fullPath
    if (fullPath === this.tabRoute.fullPath) return

    await this.tabRouter.replace(location)
    await this.$nextTick()
    this.updateTitle()
  },

  finishDownloadedPlaybackWithoutMetadata: function () {
    const file = this.applyDownloadedPlaybackSource()
    if (!file) return false

    const download = this.$store.getters.getYtDlpDownloads[this.localPlaybackDownloadId]
    const fileName = file.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, '') ?? this.videoId
    this.videoTitle = file.title || (download.videoId === this.videoId ? download.title : '') || fileName
    this.hasResolvedVideoTitle = true
    this.channelId = file.authorId || this.channelId || this.historyEntry?.authorId || ''
    this.channelName = file.author || this.channelName || this.historyEntry?.author || ''
    this.initializePlaybackRate()
    this.initializeVideoQuality()
    this.thumbnail = download.thumbnail || this.thumbnail
    this.errorMessage = null
    this.isLoading = false
    this.updateTitle()
    return true
  },
}
