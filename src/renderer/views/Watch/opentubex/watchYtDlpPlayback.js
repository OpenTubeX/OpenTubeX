import shaka from 'shaka-player'
import { findCaptionByLocale } from '../../../../captionLanguages'
import { MANIFEST_TYPE_HLS, sortCaptions } from '../../../helpers/player/utils'
import { normalizeYouTubeCaptionLanguageCode } from '../../../helpers/player/youtubeCaptionLanguages'
import {
  checkYtDlpPlaybackUrl,
  getYtDlpPlaybackSource,
  invalidateYtDlpPlaybackSource
} from '../../../helpers/player/ytDlpPlayback'
import {
  buildYtDlpPlaybackCacheKey,
  preloadYtDlpPlaybackSources,
  selectYtDlpPreloadVideoIds
} from '../../../helpers/player/ytDlpPlaybackPreload'
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'

/**
 * OpenTubeX stream extraction engine selection (built-in or yt-dlp) and the
 * videos whose yt-dlp streams are preloaded. Spread into the Watch view's `computed`.
 */
export const watchYtDlpPlaybackComputed = {
  ytDlpPlaybackCacheKey: function () {
    return buildYtDlpPlaybackCacheKey(this.$store.getters)
  },
  videoPlaybackEngine: function () {
    return supportsYtDlp ? this.$store.getters.getVideoPlaybackEngine : 'built-in'
  },
  playbackEngineSelection: function () {
    if (this.playbackEngineFallbackTarget !== null &&
      (this.ytDlpStreamsPending || this.errorMessage)) {
      return this.playbackEngineFallbackTarget
    }
    if (this.ytDlpStreamsPending) {
      // A live stream without built-in formats automatically falls back to
      // yt-dlp even when the configured default remains the built-in engine.
      if (
        this.videoPlaybackEngine === 'built-in' &&
        this.isLive &&
        this.manifestSrc === null &&
        this.legacyFormats.length === 0
      ) {
        return 'yt-dlp'
      }

      return this.videoPlaybackEngine
    }

    return this.activePlaybackEngine
  },
  otherPlaybackEngine: function () {
    return this.playbackEngineSelection === 'yt-dlp' ? 'built-in' : 'yt-dlp'
  },
  retryWithOtherPlaybackEngineLabel: function () {
    return this.otherPlaybackEngine === 'yt-dlp'
      ? this.t('Video.Retry With yt-dlp Extraction')
      : this.t('Video.Retry With Built-in Extraction')
  },
  canRetryWithOtherPlaybackEngine: function () {
    return supportsYtDlp &&
      this.errorMessage !== null &&
      !this.localFilePlayback &&
      !this.isUpcoming &&
      !this.isPostLiveDvr &&
      this.restrictedPlaybackError === null &&
      this.nonRetryablePlaybackError === null
  },
  upcomingYtDlpPreloadVideoIds: function () {
    if (
      !supportsYtDlp ||
      this.videoPlaybackEngine !== 'yt-dlp' ||
      this.customShortsPlayerActive ||
      !this.$store.getters.getYtDlpPreloadEnabled
    ) return []

    const recommendedVideos = this.hideRecommendedVideos
      ? []
      : this.recommendedVideos.filter(video =>
          !this.isHiddenVideo(this.forbiddenTitles, this.channelsHidden, video)
        )

    return selectYtDlpPreloadVideoIds({
      currentVideoId: this.videoId,
      limit: this.$store.getters.getYtDlpPreloadCount,
      queuedVideos: this.$store.getters.getWatchQueue,
      playlistVideos: this.watchingPlaylist ? this.upcomingPlaylistVideos : null,
      recommendedVideos,
    })
  },
}

/**
 * OpenTubeX yt-dlp playback: extracting streams with yt-dlp, switching the
 * extraction engine for the current video, and falling back to the other
 * engine after playback errors. Spread into the Watch view's `methods`.
 */
export const watchYtDlpPlaybackMethods = {
  preloadUpcomingYtDlpPlaybackSources(videoIds) {
    if (videoIds.length === 0) return

    preloadYtDlpPlaybackSources(videoIds, {
      concurrency: this.$store.getters.getYtDlpPreloadConcurrency,
      loadSource: videoId => getYtDlpPlaybackSource(
        videoId,
        this.ytDlpPlaybackCacheKey,
        undefined,
        this.alwaysUseYtDlpPlaybackCookies,
        false,
        true
      )
    }).catch(error => {
      console.warn('Could not preload upcoming yt-dlp playback sources', error)
    })
  },

  isYtDlpPlaybackRequested: function () {
    return supportsYtDlp &&
      this.playbackEngineFallbackTarget !== 'built-in' &&
      (
        this.videoPlaybackEngine === 'yt-dlp' ||
        this.playbackEngineFallbackTarget === 'yt-dlp'
      )
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
    this.vrProjection = source.vrProjection
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
   * Tries the other playback engine once after the selected engine exhausts
   * its own stream recovery options.
   * @param {{ code: number | string, data?: unknown[] }} error
   * @returns {Promise<boolean>}
   */
  tryPlaybackEngineFallback: async function (error) {
    if (
      !supportsYtDlp ||
      !this.$store.getters.getPlaybackEngineFallback ||
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
      console.warn(`Switching stream extraction to built-in for ${videoId} after ${reason}`)

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
      this.vrProjection = source.vrProjection
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
    console.warn(`Switching stream extraction to yt-dlp for ${videoId} after ${reason}`)

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
  },

  /**
   * Replaces the streams that the backend provided with the ones yt-dlp extracts.
   * Metadata keeps coming from the backend, except that yt-dlp captions fill in when
   * restricted playback leaves the backend caption list empty.
   *
   * The callers don't await this, they only wait for the metadata. `ytDlpStreamsPending`
   * is set synchronously here, so the player is held back (behind a thumbnail
   * placeholder) until the streams it should play are known.
   * @param {number} loadGeneration
   * @param {string} videoId
   */
  applyYtDlpPlaybackSource: async function (loadGeneration, videoId) {
    const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration
    const liveSourceMissing =
      this.isLive &&
      this.manifestSrc === null &&
      this.legacyFormats.length === 0
    const builtInLiveSourceMissing =
      this.videoPlaybackEngine === 'built-in' &&
      liveSourceMissing

    // Report missing built-in live formats when automatic fallback is
    // disabled or Built-in was selected manually.
    if (liveSourceMissing && (this.playbackEngineFallbackTarget === 'built-in' ||
      (this.videoPlaybackEngine === 'built-in' && !this.$store.getters.getPlaybackEngineFallback))) {
      this.ytDlpStreamsPending = false
      this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
      return
    }

    if (
      !supportsYtDlp ||
      this.playbackEngineFallbackTarget === 'built-in' ||
      (
        this.videoPlaybackEngine !== 'yt-dlp' &&
        this.playbackEngineFallbackTarget !== 'yt-dlp' &&
        !builtInLiveSourceMissing
      )
    ) {
      return
    }

    this.ytDlpStreamsPending = true
    let sourceApplied = false

    try {
      sourceApplied = await this.extractYtDlpPlaybackSource(
        loadGeneration,
        videoId,
        playbackEngineSwitchGeneration
      )

      if (playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration) {
        return
      }

      if (
        !sourceApplied &&
        this.isCurrentVideoLoad(loadGeneration, videoId) &&
        this.playbackEngineFallbackTarget === 'yt-dlp' &&
        this.ipBlockDetectedInCurrentChain
      ) {
        this.playbackEngineFallbackTarget = null
        const didReload = await this.runIpBlockRecoveryScriptAndReload()
        if (!this.isCurrentVideoLoad(loadGeneration, videoId) || didReload) {
          return
        }
        this.errorMessage = this.t('Video.IP block')
        return
      }

      if (
        !sourceApplied &&
        this.isCurrentVideoLoad(loadGeneration, videoId) &&
        playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
        this.manifestSrc === null &&
        this.legacyFormats.length === 0
      ) {
        this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
      }
    } catch (error) {
      // The callers don't await this, so nothing else can handle it.
      console.error('Applying the yt-dlp playback source failed', error)
      if (
        this.isCurrentVideoLoad(loadGeneration, videoId) &&
        playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
        this.manifestSrc === null &&
        this.legacyFormats.length === 0
      ) {
        this.errorMessage = this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.')
      }
    } finally {
      // A stale load has already had its state reset (and may have started its own
      // extraction), so it must not clear the flag of the load that replaced it.
      if (
        this.isCurrentVideoLoad(loadGeneration, videoId) &&
        playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration
      ) {
        if (!sourceApplied && !this.$store.getters.getPlaybackEngineFallback &&
          this.isYtDlpPlaybackRequested()) {
          this.playbackEngineFallbackTarget = 'yt-dlp'
          if (!this.errorMessage) {
            this.errorMessage = this.t('Change Format.yt-dlp Error Template', {
              error: this.t('Change Format.Not Available For This Video')
            })
          }
        }
        this.ytDlpStreamsPending = false
      }
    }
  },

  /**
   * @param {number} loadGeneration
   * @param {string} videoId
   * @param {number} playbackEngineSwitchGeneration
   * @param {boolean} useAuthentication
   * @param {boolean} cachedOnly
   */
  extractYtDlpPlaybackSource: async function (
    loadGeneration,
    videoId,
    playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration,
    useAuthentication = this.alwaysUseYtDlpPlaybackCookies,
    cachedOnly = false
  ) {
    let source
    const preferVrHls = [this, this.activePlaybackEngine === 'yt-dlp' ? this.builtInPlaybackSource : null]
      .some(source => source?.vrProjection === 'MESH' ||
        (source?.vrProjection === 'EQUIRECTANGULAR' && source.manifestMimeType === MANIFEST_TYPE_HLS))
    try {
      source = await getYtDlpPlaybackSource(videoId, this.ytDlpPlaybackCacheKey, () => {
        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration &&
          !this.ytDlpDefaultClientsFallbackToastShown
        ) {
          this.ytDlpDefaultClientsFallbackToastShown = true
          this.showTabToast({
            message: this.t('Change Format.yt-dlp Default Clients Fallback'),
            icon: ['fas', 'exchange-alt'],
          })
        }
      }, useAuthentication, cachedOnly, this.captions.length === 0, preferVrHls)
    } catch (error) {
      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) { return false }

      console.error(`yt-dlp could not provide streams for ${videoId}`, error)
      const message = useAuthentication
        ? this.t('Video.Restricted Playback Authentication Failed Template', { error: error.message })
        : this.$store.getters.getPlaybackEngineFallback
          ? this.t('Change Format.yt-dlp Fallback Template', { error: error.message })
          : this.t('Change Format.yt-dlp Error Template', { error: error.message })
      if (!this.$store.getters.getPlaybackEngineFallback && !cachedOnly) {
        this.errorMessage = message
      }
      this.showTabToast({
        message,
        time: 7000,
        icon: ['fas', 'circle-exclamation'],
      })
      return false
    }

    if (source === null) { return false }

    if (
      !this.isCurrentVideoLoad(loadGeneration, videoId) ||
      playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
    ) { return false }

    if (this.playbackEngineFallbackTarget === 'built-in' && !cachedOnly) { return false }

    if (this.activePlaybackEngine !== 'yt-dlp') {
      this.builtInPlaybackSource = {
        manifestSrc: this.manifestSrc,
        manifestMimeType: this.manifestMimeType,
        sabrData: this.sabrData,
        legacyFormats: this.legacyFormats,
        streamingDataExpiryDate: this.streamingDataExpiryDate,
        vrProjection: this.vrProjection
      }
    }

    this.manifestSrc = source.manifestSrc
    this.manifestMimeType = source.manifestMimeType
    this.legacyFormats = source.legacyFormats
    this.vrProjection = source.vrProjection ?? this.vrProjection
    if (source.vrProjection === 'EQUIRECTANGULAR') {
      this.activeFormat = 'dash'
    }
    this.isLive = source.isLive
    if (Number.isFinite(source.duration) && source.duration > 0) {
      this.videoLengthSeconds = source.duration
    }
    if (this.videoStoryboardSrc === '' && source.storyboardSrc) {
      this.videoStoryboardSrc = source.storyboardSrc
    }
    if (this.captions.length === 0 && source.captions.length > 0) {
      const languageNames = new Intl.DisplayNames([this.currentLocale, 'en'], { type: 'language' })
      const getLanguageName = (language, fallback) => {
        try {
          return languageNames.of(language) ?? fallback
        } catch {
          return fallback
        }
      }

      this.captions = sortCaptions(source.captions.map(caption => ({
        ...caption,
        label: caption.isAutoGenerated
          ? this.t('Video.Player.Auto-generated Caption Template', { language: caption.label })
          : caption.label
      })), this.preferredCaptionLocale)
      this.captionTranslations = source.captionTranslations.map(caption => {
        if (!caption.originalLanguage) return { ...caption, isAutotranslated: true }

        const translationName = getLanguageName(caption.language, caption.translationName)
        const originalLanguage = getLanguageName(caption.originalLanguage, caption.originalLanguage)

        return {
          ...caption,
          label: this.t('Video.Player.TranslatedCaptionTemplate', {
            language: translationName,
            originalLanguage
          }),
          translationName,
          isAutotranslated: true
        }
      })

      // Same as with the local API, the last auto-translation picked in the player wins over original tracks
      const rememberedLanguage = normalizeYouTubeCaptionLanguageCode(this.$store.getters.getAutoTranslatedCaptionLocale)
      const rememberedTranslation = rememberedLanguage && this.captionTranslations.find(caption =>
        normalizeYouTubeCaptionLanguageCode(caption.language) === rememberedLanguage &&
        normalizeYouTubeCaptionLanguageCode(caption.originalLanguage ?? '') !== rememberedLanguage
      )
      if (rememberedTranslation) {
        this.captions = [...this.captions, { ...rememberedTranslation, isPreferredTranslation: true }]
      } else if (!findCaptionByLocale(this.captions.filter(caption => !caption.isDubbed), this.preferredCaptionLocale)) {
        // Like built-in playback, offer a translation when no original caption matches the preferred locale
        const translation = findCaptionByLocale(this.captionTranslations, this.preferredCaptionLocale)
        if (translation) {
          this.captions = sortCaptions([...this.captions, { ...translation, isAutotranslated: true }], this.preferredCaptionLocale)
        }
      }
    }
    // HLS manifests refresh themselves, so they don't expire the way the stream URLs do.
    // Keeping the backend's date stops playback errors from being blamed on an
    // expired session, which is what a missing date would compare as.
    if (source.expiryDate !== null) {
      this.streamingDataExpiryDate = source.expiryDate
    }
    // SABR specific state, which no longer applies now that the streams come from yt-dlp
    this.sabrData = null
    this.activePlaybackEngine = 'yt-dlp'
    this.activePlaybackEngineVersion = source.version
    this.errorMessage = null

    if (!this.hasResolvedVideoTitle && source.title) {
      this.videoTitle = source.title
      this.hasResolvedVideoTitle = true
      this.updateTitle()
    }

    this.alignActiveFormatWithAvailableSources()

    return true
  },
}
