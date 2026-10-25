import { Capacitor } from '@capacitor/core'
import { usesInvidiousApi } from '../../../../apiBackends'
import { DOWNLOADED_MEDIA_MIME_TYPES } from '../../../../constants'
import { downloadWatchRoute, isPlayableDownloadFile } from '../../../helpers/downloadPlayback'
import { MANIFEST_TYPE_SABR } from '../../../helpers/player/SabrManifestParser'
import { isVideoHiddenByPreferences } from '../../../helpers/subscriptions'

/**
 * OpenTubeX downloaded files for the current video, and the downloads that
 * replace recommendations while offline. Spread into the Watch view's `computed`.
 */
export const watchDownloadedPlaybackComputed = {
  localPlaybackDownloads: function () {
    const downloads = Object.values(this.$store.getters.getYtDlpDownloads)
      .filter(download => download.status === 'completed' && ['video', 'audio'].includes(download.mode))
      .filter(download => download.files?.some(file => (
        file.videoId === this.videoId && file.available !== false
      )))
      .toSorted((a, b) => b.id - a.id)
    const activeDownloadId = Number(this.tabRoute.query.downloadId)

    return ['video', 'audio'].flatMap(mode => {
      const download = downloads.find(download => (
        download.id === activeDownloadId && download.mode === mode
      )) ?? downloads.find(download => download.mode === mode)
      return download === undefined
        ? []
        : [{ id: download.id, mode, active: download.id === activeDownloadId }]
    })
  },
  offlineDownloadSuggestions: function () {
    const seen = new Set([this.videoId])
    return Object.values(this.$store.getters.getYtDlpDownloads)
      .filter(download => download.status === 'completed' && ['video', 'audio'].includes(download.mode))
      .toSorted((a, b) => b.id - a.id)
      .flatMap(download => (download.files ?? []).filter(isPlayableDownloadFile).map(file => ({
        videoId: file.videoId,
        title: file.title || (download.videoId === file.videoId ? download.title : '') || file.videoId,
        author: file.author || download.author || '',
        authorId: file.authorId || download.authorId || '',
        thumbnail: download.videoId === file.videoId || (download.retryPayload?.externalUrl && download.files.length === 1)
          ? download.thumbnail
          : '',
        route: downloadWatchRoute(download, file.videoId, file.path)
      })))
      .filter(video => {
        if (!video.videoId || seen.has(video.videoId)) return false
        seen.add(video.videoId)
        return !isVideoHiddenByPreferences(video, {
          hiddenChannelNames: this.$store.getters.getActiveChannelsHiddenNames,
          forbiddenTitles: this.forbiddenTitles,
          hideChannelsBasedOnText: false
        })
      })
  },
  displayedRecommendations() {
    return this.isOffline ? this.offlineDownloadSuggestions : this.recommendedVideos
  },
}

/**
 * OpenTubeX playback of downloaded files: switching between a downloaded file
 * and the online streams, and opening a download without metadata while
 * offline. Spread into the Watch view's `methods`.
 */
export const watchDownloadedPlaybackMethods = {
  handleDownloadConnectionChange({ detail }) {
    this.isOffline = detail === 'offline'
    if (this.isOffline && !this.watchingPlaylist) this.abortAutoplayCountdown(true)
    if (detail !== 'offline' && this.downloadedPlaybackWithoutMetadata && !this.downloadedMetadataLoading) {
      this.downloadedMetadataLoading = true
      const loadGeneration = ++this.videoLoadGeneration
      const load = !process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(this.backendPreference)
        ? this.getVideoInformationInvidious(loadGeneration, true)
        : this.getVideoInformationLocal(loadGeneration, true)
      Promise.resolve(load).finally(() => {
        if (loadGeneration === this.videoLoadGeneration) this.downloadedMetadataLoading = false
      })
    }
    if (detail !== 'offline' || !this.isLoading || this.localFilePlayback) return
    if (this.finishDownloadedPlaybackWithoutMetadata()) {
      // Ignore metadata responses that arrive after switching to the local file.
      this.videoLoadGeneration++
    }
  },

  /**
   * Keeps the normal online metadata while replacing its streaming formats
   * with a completed file selected from the Downloads page.
   */
  applyDownloadedPlaybackSource: function (downloadId = Number(this.tabRoute.query.downloadId), filePath = this.tabRoute.query.downloadFilePath ?? null) {
    if (!Number.isInteger(downloadId) || (filePath !== null && typeof filePath !== 'string')) return false

    const download = this.$store.getters.getYtDlpDownloads[downloadId]
    const file = (download?.status === 'completed' || (process.env.IS_CAPACITOR && download?.status === 'failed')) && ['video', 'audio'].includes(download.mode)
      ? download.files?.find(file => file.videoId === this.videoId && file.available !== false &&
          (filePath === null || file.path === filePath))
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
    const url = process.env.IS_CAPACITOR
      ? Capacitor.convertFileSrc(file.path)
      : `downloadmedia://file/${downloadId}/${this.videoId}${filePath === null ? '' : `?path=${encodeURIComponent(file.path)}`}`
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
    const useFileMetadata = this.downloadedPlaybackWithoutMetadata && filePath !== null
    if (this.errorMessage || useFileMetadata) {
      const fileName = file.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, '') ?? this.videoId
      this.videoTitle = file.title || (download.videoId === this.videoId ? download.title : '') || fileName
      this.hasResolvedVideoTitle = true
      if (useFileMetadata) {
        this.channelId = file.authorId || this.channelId || this.historyEntry?.authorId || ''
        this.channelName = file.author || this.channelName || this.historyEntry?.author || ''
        this.initializePlaybackRate()
        this.initializeVideoQuality()
      }
      this.errorMessage = null
      this.isLoading = false
      this.updateTitle()
    }
    this.streamingDataExpiryDate = null
    this.activePlaybackEngine = 'built-in'
    this.activePlaybackEngineVersion = null
    this.localFilePlayback = true
    this.localPlaybackDownloadId = downloadId
    this.localPlaybackFilePath = filePath
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
    this.localPlaybackFilePath = null
    this.playbackSourceKey++
    return true
  },

  playbackSourceRouteBase: function (fullPath) {
    const url = new URL(fullPath, 'https://opentubex.invalid')
    url.searchParams.delete('downloadId')
    url.searchParams.delete('downloadFilePath')
    return `${url.pathname}${url.search}${url.hash}`
  },

  replacePlaybackSourceRoute: async function (downloadId = null) {
    const query = { ...this.tabRoute.query }
    delete query.downloadFilePath
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
    this.downloadedPlaybackWithoutMetadata = true
    this.updateTitle()
    return true
  },

  useOnlinePlaybackSource: async function () {
    if (!this.localFilePlayback || typeof this.tabRoute.query.downloadId !== 'string') return

    const playbackPosition = this.getTimestamp()
    if (this.restoreOnlinePlaybackSource()) {
      await this.replacePlaybackSourceRoute()
      return
    }

    const query = { ...this.tabRoute.query }
    delete query.downloadId
    delete query.downloadFilePath
    if (playbackPosition > 0) query.oneTimeTimestamp = playbackPosition
    await this.tabRouter.replace({ path: this.tabRoute.path, query })
  },

  useLocalPlaybackSource: async function (downloadId) {
    if (!Number.isInteger(downloadId) ||
      !this.localPlaybackDownloads.some(download => download.id === downloadId)) return

    if (!this.applyDownloadedPlaybackSource(downloadId, null)) return

    await this.replacePlaybackSourceRoute(downloadId)
  },
}
