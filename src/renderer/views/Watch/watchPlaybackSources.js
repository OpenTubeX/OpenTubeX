import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { getYtDlpPlaybackSource } from '../../helpers/player/ytDlpPlayback'
import { sortCaptions } from '../../helpers/player/utils'
import { getCompatibleAdaptiveFormats } from '../../helpers/player/compatibleAdaptiveFormats'
import { convertInvidiousToLocalFormat, generateInvidiousDashManifestLocally } from '../../helpers/api/invidious'
import { generateAudioTrackField } from '../../helpers/api/local'
import { videoApi } from '../../helpers/api/videoApi'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'

/**
 * @typedef {{
 *   scheme: string, url: string, poToken: string, ustreamerConfig: string,
 *   clientInfo: { clientName: number, clientVersion: string, osName: string, osVersion: string }
 * }} SabrData
 */

// Shaka schemes are registered renderer-wide across retained tabs.
let nextSabrSchemeId = 0

/** Stream extraction and manifest creation for an active Watch view. */
export const watchPlaybackSources = {
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

    // A manual Built-in selection is authoritative. If its metadata reload
    // still has no live source, report that result instead of silently
    // switching back to yt-dlp or leaving an unexplained empty player area.
    if (liveSourceMissing && this.playbackEngineFallbackTarget === 'built-in') {
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

    try {
      const sourceApplied = await this.extractYtDlpPlaybackSource(
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
      }, useAuthentication, cachedOnly, this.captions.length === 0)
    } catch (error) {
      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
          playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration
      ) { return false }

      console.error(`yt-dlp could not provide streams for ${videoId}`, error)
      this.showTabToast({
        message: useAuthentication
          ? this.t('Video.Restricted Playback Authentication Failed Template', { error: error.message })
          : this.t('Change Format.yt-dlp Fallback Template', { error: error.message }),
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
        streamingDataExpiryDate: this.streamingDataExpiryDate
      }
    }

    this.manifestSrc = source.manifestSrc
    this.manifestMimeType = source.manifestMimeType
    this.legacyFormats = source.legacyFormats
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
        if (!caption.originalLanguage) return caption

        const translationName = getLanguageName(caption.language, caption.translationName)
        const originalLanguage = getLanguageName(caption.originalLanguage, caption.originalLanguage)

        return {
          ...caption,
          label: this.t('Video.Player.TranslatedCaptionTemplate', {
            language: translationName,
            originalLanguage
          }),
          translationName
        }
      })
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

  /**
   * @param {import('youtubei.js').YT.VideoInfo} videoInfo
   * @param {boolean} includeThumbnails
   */
  createLocalDashManifest: async function (videoInfo, includeThumbnails = false) {
    const formats = new Set(getCompatibleAdaptiveFormats(videoInfo.streaming_data.adaptive_formats))
    const xmlData = await videoInfo.toDash({
      format_filter: format => format.has_video && !format.has_audio && !formats.has(format),
      manifest_options: {
        include_thumbnails: includeThumbnails,
      },
    })

    return `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(xmlData)}`
  },

  /**
   * @param {import('youtubei.js').IParsedResponse} videoInfo
   * @param {string} poToken
   * @param {SabrData['clientInfo']} clientInfo
   * @param {import('../../helpers/player/SabrManifestParser').SabrManifest['storyboards']} storyboards
   */
  createLocalSabrManifest: function (videoInfo, poToken, clientInfo, storyboards) {
    const url = new URL(videoInfo.streaming_data.server_abr_streaming_url)
    url.searchParams.set('cpn', videoInfo.cpn)
    // Shaka's scheme registry is renderer-global. Each retained tab therefore
    // needs its own scheme so one SABR player cannot replace or unregister
    // another player's request handler.
    const scheme = `sabr${nextSabrSchemeId++}`
    const formats = getCompatibleAdaptiveFormats(videoInfo.streaming_data.adaptive_formats)
    const formatDurationsMs = formats
      .map(format => format.approx_duration_ms)
      .filter(Number.isFinite)
    const fallbackDurationSeconds = Number.isFinite(videoInfo.basic_info.duration)
      ? videoInfo.basic_info.duration
      : 0

    this.sabrData = {
      scheme,
      url: url.toString(),
      poToken,
      ustreamerConfig: videoInfo.player_config.media_common_config.media_ustreamer_request_config.video_playback_ustreamer_config,
      clientInfo
    }

    /** @type {import('../../helpers/player/SabrManifestParser').SabrManifest} */
    const sabrManifest = {
      scheme,
      // Different formats have different durations and
      // use of slightly longer duration in PresentationTimeline causes player to stuck at the end
      duration: formatDurationsMs.length > 0
        ? Math.min(...formatDurationsMs) / 1000
        : fallbackDurationSeconds,
      formats: formats.map((format) => ({
        itag: format.itag,
        lastModified: format.last_modified_ms,
        mimeType: format.mime_type,
        xtags: format.xtags,
        bitrate: format.bitrate,
        initRange: format.init_range,
        indexRange: format.index_range,
        width: format.width,
        height: format.height,
        frameRate: format.fps,
        quality: format.quality,
        language: format.language,
        audioSampleRate: format.audio_sample_rate,
        audioChannels: format.audio_channels,
        isDrc: format.is_drc,
        isVoiceBoost: format.is_vb,
        isOriginal: format.is_original,
        isDubbed: format.is_dubbed,
        isAutoDubbed: format.is_auto_dubbed,
        isDescriptive: format.is_descriptive,
        isSecondary: format.is_secondary,
        spatialAudio: !!format.spatial_audio_type,
        label: format.audio_track?.display_name,
        colorTransferCharacteristics: format.color_info?.transfer_characteristics,
        colorPrimaries: format.color_info?.primaries
      })),
      captions: this.captions,
      chapters: this.videoChapters,
      storyboards
    }

    return `data:${MANIFEST_TYPE_SABR},${encodeURIComponent(JSON.stringify(sabrManifest))}`
  },

  createInvidiousDashManifest: async function (result) {
    let url = `${this.currentInvidiousInstanceUrl}/api/manifest/dash/id/${this.videoId}`

    // If we are in Electron,
    // we can use YouTube.js' DASH manifest generator to generate the manifest.
    // Using YouTube.js' gives us support for multiple audio tracks (currently not supported by Invidious)
    if (process.env.SUPPORTS_LOCAL_API) {
      const adaptiveFormats = await this.getAdaptiveFormatsInvidious(result)

      /** @type {import('youtubei.js').Misc.Format[]} */
      const formats = []

      /** @type {import('youtubei.js').Misc.Format[]} */
      const audioFormats = []

      let hasMultipleAudioTracks = false

      for (const format of adaptiveFormats) {
        const localFormat = convertInvidiousToLocalFormat(format)

        if (localFormat.has_audio) {
          audioFormats.push(localFormat)

          if (localFormat.is_dubbed || localFormat.is_descriptive || localFormat.is_secondary || localFormat.is_auto_dubbed) {
            hasMultipleAudioTracks = true
          }
        }

        formats.push(localFormat)
      }

      if (hasMultipleAudioTracks) {
        // match YouTube's local API response with English
        const languageNames = new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' })
        for (const format of audioFormats) {
          generateAudioTrackField(format, languageNames)
        }
      }

      const manifest = await generateInvidiousDashManifestLocally(formats)

      url = `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(manifest)}`
    } else if (this.proxyVideos) {
      url += '?local=true'
    }

    return url
  },

  getAdaptiveFormatsInvidious: async function (existingInfoResult = null) {
    let result
    if (existingInfoResult) {
      result = existingInfoResult
    } else {
      result = await videoApi.getVideoInformation(this.videoId, 'invidious')
    }

    result.adaptiveFormats.forEach((format) => {
      format.bitrate = parseInt(format.bitrate)

      // audio streams don't have a size property
      if (typeof format.size === 'string') {
        const [stringWidth, stringHeight] = format.size.split('x')

        format.width = parseInt(stringWidth)
        format.height = parseInt(stringHeight)
      }
    })

    return result.adaptiveFormats
  }
}
