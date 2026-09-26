/**
 * Playback source and format controls for the Watch view. Dependencies are
 * supplied by the view; the methods use its existing reactive playback state.
 * @param {{supportsYtDlp: boolean, showToast: (toast: object) => void}} dependencies
 */
export function createWatchPlaybackOrchestration({ supportsYtDlp, showToast }) {
  return {
    handleFormatChange: function (format) {
      switch (format) {
        case 'dash':
          this.enableDashFormat()
          break
        case 'legacy':
          this.enableLegacyFormat()
          break
        case 'audio':
          this.enableAudioFormat()
          break
      }
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
      if (playbackPosition > 0) query.oneTimeTimestamp = playbackPosition
      await this.tabRouter.replace({ path: this.tabRoute.path, query })
    },

    useLocalPlaybackSource: async function (downloadId) {
      if (!Number.isInteger(downloadId) ||
        !this.localPlaybackDownloads.some(download => download.id === downloadId)) return

      if (!this.applyDownloadedPlaybackSource(downloadId)) return

      await this.replacePlaybackSourceRoute(downloadId)
    },

    /**
     * Changes the stream extraction method for the current video without
     * changing the default selected in the settings.
     * @param {'built-in' | 'yt-dlp'} playbackEngine
     */
    handlePlaybackEngineChange: async function (playbackEngine) {
      if (
        !supportsYtDlp ||
        playbackEngine === this.playbackEngineSelection
      ) {
        return
      }

      const playbackEngineSwitchGeneration = ++this.playbackEngineSwitchGeneration
      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackPosition = this.getTimestamp()
      if (playbackPosition > 0) {
        this.oneTimeTimestamp = playbackPosition
      }

      this.playbackEngineFallbackAttemptedForCurrentVideo = false
      this.playbackEngineFallbackTarget = playbackEngine
      this.errorMessage = null

      const activePlaybackSourceAvailable = this.activeFormat === 'legacy'
        ? this.legacyFormats.length > 0
        : this.manifestSrc !== null

      if (playbackEngine === this.activePlaybackEngine && activePlaybackSourceAvailable) {
        this.ytDlpStreamsPending = false
        return
      }

      // `ytDlpStreamsPending` removes the current player from the DOM. Destroy
      // Shaka first so its live manifest refreshes and segment retries cannot
      // survive the engine switch as an orphaned player.
      if (this.$refs.player) {
        await this.destroyPlayer()
      }

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration ||
        this.playbackEngineFallbackTarget !== playbackEngine
      ) {
        return
      }

      this.ytDlpStreamsPending = true
      await this.$nextTick()

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration ||
        this.playbackEngineFallbackTarget !== playbackEngine
      ) {
        return
      }

      if (playbackEngine === 'yt-dlp') {
        try {
          const sourceApplied = await this.extractYtDlpPlaybackSource(
            loadGeneration,
            videoId,
            playbackEngineSwitchGeneration
          )
          if (
            !sourceApplied &&
            this.isCurrentVideoLoad(loadGeneration, videoId) &&
            playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
            this.manifestSrc === null &&
            this.legacyFormats.length === 0
          ) {
            this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
          }
        } finally {
          if (
            this.isCurrentVideoLoad(loadGeneration, videoId) &&
            playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
          ) {
            this.ytDlpStreamsPending = false
          }
        }
        return
      }

      const source = this.builtInPlaybackSource
      if (
        source === null ||
        (source.manifestSrc === null && source.legacyFormats.length === 0) ||
        (
          source.streamingDataExpiryDate !== null &&
          new Date() > source.streamingDataExpiryDate
        )
      ) {
        await this.reloadView({ preserveTitle: true })
        return
      }

      this.manifestSrc = source.manifestSrc
      this.manifestMimeType = source.manifestMimeType
      this.sabrData = source.sabrData
      this.legacyFormats = source.legacyFormats
      this.streamingDataExpiryDate = source.streamingDataExpiryDate
      this.activePlaybackEngine = 'built-in'
      this.activePlaybackEngineVersion = null
      this.errorMessage = null
      this.alignActiveFormatWithAvailableSources()
      this.ytDlpStreamsPending = false
    },

    retryWithOtherPlaybackEngine: function () {
      this.customErrorIcon = null
      return this.handlePlaybackEngineChange(this.otherPlaybackEngine)
    },

    enableDashFormat: function () {
      if (this.activeFormat === 'dash') {
        return
      }

      if (!this.dashFormatAvailable) {
        showToast({
          message: this.t('Change Format.Dash formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'dash'
    },

    enableLegacyFormat: function () {
      if (this.activeFormat === 'legacy') {
        return
      }

      if (!this.legacyFormatAvailable) {
        showToast({
          message: this.t('Change Format.Legacy formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'legacy'
    },

    enableAudioFormat: function () {
      if (this.activeFormat === 'audio') {
        return
      }

      if (!this.audioFormatAvailable) {
        showToast({
          message: this.t('Change Format.Audio formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'audio'
    }
  }
}
