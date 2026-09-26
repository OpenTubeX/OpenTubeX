const ANDROID_HTTP_ERROR_RETRY_DELAY_MS = 750

/**
 * Owns player errors, recovery, and engine fallback for an active Watch view.
 * @param {{
 *   supportsYtDlp: boolean,
 *   shaka: typeof import('shaka-player').default,
 *   checkYtDlpPlaybackUrl: typeof import('../../helpers/player/ytDlpPlayback').checkYtDlpPlaybackUrl,
 *   invalidateYtDlpPlaybackSource: typeof import('../../helpers/player/ytDlpPlayback').invalidateYtDlpPlaybackSource,
 *   MANIFEST_TYPE_SABR: string,
 * }} dependencies
 */
export function createWatchPlayerRecovery({ supportsYtDlp, shaka, checkYtDlpPlaybackUrl, invalidateYtDlpPlaybackSource, MANIFEST_TYPE_SABR }) {
  return {
    /**
     * Starts the one stream-error recovery allowed for the current video.
     * @param {string} specificError
     * @returns {boolean} whether recovery started
     */
    beginStreamErrorRecoveryOnce: function (specificError) {
      if (this.streamErrorReloadAttemptedForCurrentVideo) {
        return false
      }

      this.streamErrorReloadAttemptedForCurrentVideo = true
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
      this.showTabToast({
        message: `${this.t('Video.Reloading video after streaming URL error')}: ${specificError}`,
        icon: ['fas', 'sync'],
      })
      return true
    },

    /**
     * Reload once for a playback error that may be fixed by fetching fresh
     * streaming data.
     * @param {string} specificError
     * @returns {Promise<boolean>} whether a reload was started
     */
    reloadAfterStreamErrorOnce: async function (specificError) {
      if (!this.beginStreamErrorRecoveryOnce(specificError)) {
        return false
      }

      await this.reloadView()
      return true
    },

    isAndroidTransientHttpRecoveryEnabled() {
      return process.env.IS_CAPACITOR
    },

    async retryAndroidTransientHttpError() {
      if (this.androidHttpErrorRecoveryAttemptedForCurrentVideo) return false

      this.androidHttpErrorRecoveryAttemptedForCurrentVideo = true
      const videoId = this.videoId
      await new Promise(resolve => setTimeout(resolve, ANDROID_HTTP_ERROR_RETRY_DELAY_MS))
      if (videoId !== this.videoId || this.isLoading) return true
      return this.$refs.player?.retryStreaming() === true
    },

    /**
     * Refreshes yt-dlp's streams and recreates only the player. The watch-page
     * metadata and the built-in fallback source stay loaded.
     * @param {string} specificError
     * @param {unknown} [playbackUrl] exact URL to verify after a timeout
     * @returns {Promise<boolean>} whether recovery handled the error
     */
    reloadYtDlpPlayerAfterStreamErrorOnce: async function (specificError, playbackUrl) {
      if (!this.beginStreamErrorRecoveryOnce(specificError)) {
        return false
      }

      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration
      this.setPlayerReloadState(this.$refs.player?.getSabrReloadState())
      this.initializeVideoQuality()

      const timestamp = this.getTimestamp()
      if (timestamp > 0) {
        this.oneTimeTimestamp = timestamp
      }

      if (this.$refs.player) {
        await this.destroyPlayer()
      }

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) {
        return true
      }

      const playbackUrlStatus = playbackUrl === undefined
        ? 'inconclusive'
        : await checkYtDlpPlaybackUrl(playbackUrl)

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) {
        return true
      }

      if (playbackUrlStatus === 'rejected') {
        invalidateYtDlpPlaybackSource(videoId)
      }

      this.ytDlpStreamsPending = true
      await this.$nextTick()

      try {
        return await this.extractYtDlpPlaybackSource(
          loadGeneration,
          videoId,
          playbackEngineSwitchGeneration
        )
      } finally {
        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
        ) {
          this.ytDlpStreamsPending = false
        }
      }
    },

    /**
     * @param {import('shaka-player/dist/shaka-player.ui').default.util.Error} error
     */
    handlePlayerError: async function (error) {
      // the error is logged to the console inside the player so we don't have to do it here

      // The player is only rendered while loading is false. An error received
      // after loading starts belongs to the outgoing player during its unmount
      // tick and must not change the new player's format or trigger a reload.
      if (this.isLoading) {
        return
      }

      const { Code } = shaka.util.Error

      if (error.code === Code.HTTP_ERROR) {
        if (error.data[1]?.message === 'Failed to fetch' && !navigator.onLine) {
          // Internet connection was lost, do nothing on our side as
          // shaka-player will keep trying until the internet connection returns and resume playback automatically when it does
          return
        }

        if (this.isAndroidTransientHttpRecoveryEnabled() && await this.retryAndroidTransientHttpError()) {
          return
        }
      }

      // A terminal player error can still come from a transiently bad yt-dlp
      // URL or extraction. Refresh those streams once before changing format or
      // restoring the cached built-in source (which may use SABR).
      if (this.activePlaybackEngine === 'yt-dlp') {
        if (error.code !== Code.TIMEOUT) {
          invalidateYtDlpPlaybackSource(this.videoId)
        }
        const status = error.code === Code.BAD_HTTP_STATUS ? error.data[1] : error.code
        const playbackUrl = error.code === Code.TIMEOUT ? error.data?.[0] : undefined
        if (await this.reloadYtDlpPlayerAfterStreamErrorOnce(`[PLAYER_ERROR: ${status}]`, playbackUrl)) {
          return
        }
      }

      if (error.code === Code.BAD_HTTP_STATUS) {
        switch (error.data[1]) {
          case 429:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            if (await this.tryPlaybackEngineFallback(error)) {
              return
            }

            this.errorMessage = '[BAD_HTTP_STATUS: 429] Ratelimited'
            return
          case 403:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            // Streaming URLs are bound to the IP they were issued to, so they also
            // start returning 403 when our own IP changes (reconnect, prefix rotation,
            // VPN switch). An expired watch session likewise needs a fresh fetch.
            // Reload once before escalating — to the IP block recovery script, or to
            // the session-expired error — so the genuine failure paths are unchanged
            // apart from the extra reload before them.
            {
              const sessionExpired = new Date() > this.streamingDataExpiryDate
              const specificError = sessionExpired
                ? '[BAD_HTTP_STATUS: 403] YouTube watch session expired. Please reopen this video.'
                : this.videoGenreIsMusic
                  ? '[BAD_HTTP_STATUS: 403] Potential causes: IP block, streaming URL deciphering failed or music video geo-block'
                  : '[BAD_HTTP_STATUS: 403] Potential causes: IP block or streaming URL deciphering failed'

              if (await this.reloadAfterStreamErrorOnce(specificError)) {
                return
              }

              if (await this.tryPlaybackEngineFallback(error)) {
                return
              }

              if (sessionExpired) {
                this.errorMessage = specificError
                this.customErrorIcon = ['fas', 'clock']
                return
              }

              this.errorMessage = specificError
              this.ipBlockDetectedInCurrentChain = true
              await this.runIpBlockRecoveryScriptAndReload()
              return
            }
        }
      } else if (error.code === Code.VIDEO_ERROR) {
        if (this.activeFormat === 'legacy') {
          if (new Date() > this.streamingDataExpiryDate) {
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            const specificError = '[VIDEO_ERROR] YouTube watch session expired. Please reopen this video.'

            if (await this.reloadAfterStreamErrorOnce(specificError)) {
              return
            }

            if (await this.tryPlaybackEngineFallback(error)) {
              return
            }

            this.errorMessage = specificError
            this.customErrorIcon = ['fas', 'clock']
            return
          }
        }
      }

      if (
        await this.reloadSabrStream(
          this.$refs.player?.getSabrReloadState(),
          'Refreshing SABR stream after playback error'
        )
      ) { return }

      // yt-dlp legacy formats come from the same extraction as its DASH
      // formats. Prefer the independent built-in source after the one-shot
      // yt-dlp refresh above, and keep legacy as the last resort when no
      // built-in source is available.
      if (
        this.activePlaybackEngine === 'yt-dlp' &&
        await this.tryPlaybackEngineFallback(error)
      ) {
        return
      }

      const stopPlaybackRecovery = async () => {
        if (await this.tryPlaybackEngineFallback(error)) {
          return
        }

        this.handleWatchProgressAutoSaveWhenProgressEnabled()
        const status = error.code === Code.BAD_HTTP_STATUS ? error.data[1] : error.code
        this.errorMessage = `[PLAYER_ERROR: ${status}] Unable to recover the video stream. Please reload this video.`
      }

      if (
        this.activeFormat === 'dash' &&
        this.manifestMimeType === MANIFEST_TYPE_SABR &&
        !this.isLive &&
        !this.isPostLiveDvr &&
        this.legacyFormats.length === 0
      ) {
        // Audio is an explicit playback mode, not a degraded video fallback.
        // Keep the bounded refresh behavior above, then stop with the actual
        // error instead of briefly replacing the video player with audio.
        await stopPlaybackRecovery()
        return
      }

      if (this.isLive || this.isPostLiveDvr) {
        if (this.activeFormat === 'dash') {
          await stopPlaybackRecovery()
        } else {
          console.error('Unable to play audio formats. Reverting to DASH formats...')
          this.enableDashFormat()
        }
      } else {
        // Audio remains available when explicitly selected, but a broken video
        // stream must never silently turn into audio-only playback.

        switch (this.activeFormat) {
          case 'dash':
            if (this.legacyFormats.length > 0) {
              console.error('Unable to play DASH formats. Reverting to legacy formats...')
              this.enableLegacyFormat()
            } else {
              await stopPlaybackRecovery()
            }
            break
          case 'legacy':
            await stopPlaybackRecovery()
            break
          case 'audio':
            console.error('Unable to play audio formats. Reverting to DASH formats...')
            this.enableDashFormat()
            break
        }
      }
    },

    /**
     * Tries the other playback engine once after the selected engine exhausts
     * its own stream recovery options.
     * @param {import('shaka-player/dist/shaka-player.ui').default.util.Error} error
     * @returns {Promise<boolean>}
     */
    tryPlaybackEngineFallback: async function (error) {
      if (
        !supportsYtDlp ||
        this.playbackEngineFallbackAttemptedForCurrentVideo ||
        this.isUpcoming
      ) {
        return false
      }

      const status = error.code === shaka.util.Error.Code.BAD_HTTP_STATUS
        ? error.data[1]
        : error.code
      const reason = `[PLAYER_ERROR: ${status}]`
      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId
      const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration

      if (this.activePlaybackEngine === 'yt-dlp') {
        const source = this.builtInPlaybackSource
        if (
          source === null ||
          (source.manifestSrc === null && source.legacyFormats.length === 0) ||
          (
            source.streamingDataExpiryDate !== null &&
            new Date() > source.streamingDataExpiryDate
          )
        ) {
          return false
        }

        this.playbackEngineFallbackAttemptedForCurrentVideo = true
        this.playbackEngineFallbackTarget = 'built-in'

        if (this.$refs.player) {
          await this.destroyPlayer()
        }

        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }

        this.ytDlpStreamsPending = true
        await this.$nextTick()
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }

        this.manifestSrc = source.manifestSrc
        this.manifestMimeType = source.manifestMimeType
        this.sabrData = source.sabrData
        this.legacyFormats = source.legacyFormats
        this.streamingDataExpiryDate = source.streamingDataExpiryDate
        this.activePlaybackEngine = 'built-in'
        this.activePlaybackEngineVersion = null

        this.alignActiveFormatWithAvailableSources()

        this.showTabToast({
          message: this.t('Change Format.yt-dlp Fallback Template', { error: reason }),
          icon: ['fas', 'exchange-alt'],
        })
        this.ytDlpStreamsPending = false
        return true
      }

      this.playbackEngineFallbackAttemptedForCurrentVideo = true
      this.playbackEngineFallbackTarget = 'yt-dlp'

      if (this.$refs.player) {
        await this.destroyPlayer()
      }

      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) {
        return true
      }

      this.ytDlpStreamsPending = true
      this.showTabToast({
        message: this.t('Change Format.Built-in Fallback Template', { error: reason }),
        icon: ['fas', 'exchange-alt'],
      })

      try {
        const fallbackApplied = await this.extractYtDlpPlaybackSource(
          loadGeneration,
          videoId,
          playbackEngineSwitchGeneration
        )
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }
        if (!fallbackApplied) {
          this.playbackEngineFallbackTarget = null
        }
        return fallbackApplied
      } catch (fallbackError) {
        if (
          !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
        ) {
          return true
        }
        this.playbackEngineFallbackTarget = null
        console.error('Falling back to yt-dlp playback failed', fallbackError)
        return false
      } finally {
        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
        ) {
          this.ytDlpStreamsPending = false
        }
      }
    },

    alignActiveFormatWithAvailableSources: function () {
      if (
        (this.activeFormat === 'dash' || this.activeFormat === 'audio') &&
        this.manifestSrc === null &&
        this.legacyFormats.length > 0
      ) {
        this.activeFormat = 'legacy'
      } else if (this.activeFormat === 'legacy' && this.legacyFormats.length === 0 && this.manifestSrc !== null) {
        this.activeFormat = 'dash'
      } else if (this.activeFormat === 'audio' && !this.audioFormatAvailable) {
        this.activeFormat = 'dash'
      }
    }
  }
}
