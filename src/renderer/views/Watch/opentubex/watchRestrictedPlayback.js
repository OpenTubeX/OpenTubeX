import { ytDlp } from '../../../helpers/ytDlp'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../../helpers/restricted-playback'

/**
 * OpenTubeX authentication state for age-restricted and members-only videos.
 * Spread into the Watch view's `computed`.
 */
export const watchRestrictedPlaybackComputed = {
  hasConfiguredRestrictedPlaybackAuthentication: function () {
    return hasConfiguredRestrictedPlaybackAuthentication(this.$store.getters)
  },
  alwaysUseYtDlpPlaybackCookies: function () {
    return this.$store.getters.getYtDlpPlaybackAlwaysUseCookies &&
      this.hasConfiguredRestrictedPlaybackAuthentication
  },
  canTryRestrictedPlaybackWithCookies: function () {
    return this.restrictedPlaybackError !== null &&
      this.hasConfiguredRestrictedPlaybackAuthentication &&
      !this.ytDlpStreamsPending
  },
}

/**
 * OpenTubeX restricted playback: age-restricted, members-only, private and DRM
 * errors, and playing restricted videos through yt-dlp with the configured
 * authentication. Spread into the Watch view's `methods`.
 */
export const watchRestrictedPlaybackMethods = {
  setRestrictedPlaybackError: function (type) {
    this.restrictedPlaybackError = type
    this.errorMessage = type === 'members'
      ? this.t('Video.MembersOnly')
      : this.t('Video.AgeRestricted')
    this.customErrorIcon = type === 'members' ? ['fas', 'money-check-dollar'] : null
    this.skipUnavailablePlaylistVideo = type === 'members' && !this.hasConfiguredRestrictedPlaybackAuthentication

    if (this.hasConfiguredRestrictedPlaybackAuthentication &&
      (this.isYtDlpPlaybackRequested() || this.$store.getters.getPlaybackEngineFallback)) {
      this.tryCachedRestrictedPlayback(type).catch(error => {
        console.warn('Could not restore cached authenticated playback', error)
      })
    }
  },

  /**
   * Sets an error that switching stream extraction methods cannot resolve.
   * @param {'private' | 'drm'} type
   */
  setNonRetryablePlaybackError: function (type) {
    this.nonRetryablePlaybackError = type
    this.errorMessage = type === 'private'
      ? this.t('Video.Private')
      : this.t('Video.DRMProtected')
    this.skipUnavailablePlaylistVideo = type === 'private'
  },

  getRestrictedPlaybackErrorType: function (message) {
    if (typeof message !== 'string') {
      return null
    }

    const normalizedMessage = message.toLowerCase()
    if (
      normalizedMessage.includes('members-only') ||
      normalizedMessage.includes('members only') ||
      normalizedMessage.includes("available to this channel's members")
    ) {
      return 'members'
    }

    if (
      normalizedMessage.includes('age-restricted') ||
      normalizedMessage.includes('age restricted') ||
      normalizedMessage.includes('confirm your age')
    ) {
      return 'age'
    }

    return null
  },

  tryCachedRestrictedPlayback: async function (restrictedPlaybackError) {
    const loadGeneration = this.videoLoadGeneration
    const videoId = this.videoId
    const playbackEngineSwitchGeneration = this.playbackEngineSwitchGeneration
    const previousFallbackTarget = this.playbackEngineFallbackTarget

    const sourceApplied = await this.extractYtDlpPlaybackSource(
      loadGeneration,
      videoId,
      playbackEngineSwitchGeneration,
      true,
      true
    )

    if (!this.isCurrentVideoLoad(loadGeneration, videoId) ||
      playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration ||
      this.restrictedPlaybackError !== restrictedPlaybackError) {
      return
    }

    if (sourceApplied) {
      this.restrictedPlaybackError = null
      this.playbackEngineFallbackTarget = null
    } else {
      this.playbackEngineFallbackTarget = previousFallbackTarget
      this.skipUnavailablePlaylistVideo = restrictedPlaybackError === 'members'
    }
  },

  tryRestrictedPlaybackWithCookies: async function () {
    const restrictedPlaybackError = this.restrictedPlaybackError
    if (restrictedPlaybackError === null || !this.hasConfiguredRestrictedPlaybackAuthentication) {
      return
    }

    const loadGeneration = this.videoLoadGeneration
    const videoId = this.videoId
    const playbackEngineSwitchGeneration = ++this.playbackEngineSwitchGeneration
    this.errorMessage = null
    this.customErrorIcon = null
    this.playbackEngineFallbackTarget = 'yt-dlp'
    this.ytDlpStreamsPending = true
    this.ytDlpDefaultClientsFallbackToastShown = false

    try {
      const sourceApplied = await this.extractYtDlpPlaybackSource(
        loadGeneration,
        videoId,
        playbackEngineSwitchGeneration,
        true
      )

      if (!this.isCurrentVideoLoad(loadGeneration, videoId) ||
        playbackEngineSwitchGeneration !== this.playbackEngineSwitchGeneration) {
        return
      }

      if (sourceApplied) {
        this.restrictedPlaybackError = null
        this.playbackEngineFallbackTarget = null
        if (this.recommendedVideos.length === 0) {
          this.loadAuthenticatedYtDlpRecommendations(loadGeneration, videoId)
        }
      } else {
        this.setRestrictedPlaybackError(restrictedPlaybackError)
      }
    } catch (error) {
      if (this.isCurrentVideoLoad(loadGeneration, videoId) &&
        playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration) {
        console.error(`Authenticated yt-dlp playback failed for ${videoId}`, error)
        this.setRestrictedPlaybackError(restrictedPlaybackError)
        this.showTabToast({
          message: this.t('Video.Restricted Playback Authentication Failed Template', {
            error: error.message
          }),
          time: 7000,
          icon: ['fas', 'circle-exclamation']
        })
      }
    } finally {
      if (this.isCurrentVideoLoad(loadGeneration, videoId) &&
        playbackEngineSwitchGeneration === this.playbackEngineSwitchGeneration) {
        this.ytDlpStreamsPending = false
      }
    }
  },

  loadAuthenticatedYtDlpRecommendations: async function (loadGeneration, videoId) {
    try {
      const result = await ytDlp.ytDlpGetRecommendations(videoId)
      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

      if (result === null || 'error' in result) {
        if (result?.error) {
          console.warn('yt-dlp could not provide authenticated recommendations', result.error)
        }
        return
      }

      if (this.recommendedVideos.length === 0) {
        this.recommendedVideos = result.sort(this.sortWatchedVideosLast)
      }
    } catch (error) {
      console.warn('Could not load authenticated yt-dlp recommendations', error)
    }
  },
}
