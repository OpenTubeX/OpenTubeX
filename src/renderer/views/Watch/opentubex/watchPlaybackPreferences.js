import { parseChannelPreferences } from '../../../helpers/channel-preferences'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../../helpers/player/autoQuality'
import { limitQualityOnMeteredNetwork } from '../../../helpers/player/meteredNetworkQuality'
import { showToast } from '../../../helpers/utils'

/**
 * OpenTubeX playback preferences: the initial playback rate and video quality,
 * and the per-channel playback speed, quality, subtitles and volume.
 * Spread into the Watch view's `methods`.
 */
export const watchPlaybackPreferencesMethods = {
  handleChannelPlaybackSpeedManualSave() {
    // Should be called by manual action, settings should be checked in UI
    if (!this.channelId) {
      return
    }

    this.saveChannelPlaybackSpeed(this.currentPlaybackRate)
    showToast({
      message: `${this.t('Video.Channel Playback Speed Saved')}: ${this.currentPlaybackRate}×`,
      icon: ['fas', 'gauge']
    })
  },
  handleChannelVideoQualityManualSave() {
    // Should be called by manual action, settings should be checked in UI
    if (!this.channelId) {
      return
    }

    if (this.saveChannelVideoQuality(this.currentVideoQuality)) {
      const savedQuality = this.normalizeVideoQuality(this.currentVideoQuality)
      const savedQualityLabel = savedQuality === 'auto'
        ? this.t('Settings.Player Settings.Default Quality.Auto')
        : `${savedQuality}p`
      showToast({
        message: `${this.t('Video.Channel Video Quality Saved')}: ${savedQualityLabel}`,
        icon: ['fas', 'film']
      })
    }
  },
  handleChannelSubtitlesStateManualSave() {
    // Should be called by manual action, settings should be checked in UI
    if (!this.channelId || this.currentSubtitlesState === null) {
      return
    }

    this.saveChannelSubtitlesState(this.currentSubtitlesState)
    showToast({
      message: `${this.t('Video.Channel Subtitles State Saved')}: ${this.currentSubtitlesState ? '✓' : '✕'}`,
      icon: ['fas', 'closed-captioning']
    })
  },
  handleChannelVolumeManualSave() {
    // Should be called by manual action, settings should be checked in UI
    if (!this.channelId || this.currentVolume === null) {
      return
    }

    this.saveChannelVolume(this.currentVolume)
    showToast({
      message: `${this.t('Video.Channel Volume Saved')}: ${Math.round(this.currentVolume * 100)}%`,
      icon: ['fas', 'volume-high']
    })
  },

  /**
   * @param {string} newQuality
   */
  updateVideoQuality(newQuality) {
    this.currentVideoQuality = this.normalizeVideoQuality(newQuality)
  },

  handlePlaybackRateUserSet(newRate) {
    if (!this.$store.getters.getEnableChannelSettings || !this.$store.getters.getAutoUpdateChannelPlaybackSpeeds || !this.channelId) {
      return
    }

    this.saveChannelPlaybackSpeed(newRate)
  },

  /**
   * @param {string} newQuality
   */
  handleVideoQualityUserSet(newQuality) {
    if (!this.$store.getters.getEnableChannelSettings || !this.$store.getters.getAutoUpdateChannelVideoQualities || !this.channelId) {
      return
    }

    this.saveChannelVideoQuality(newQuality)
  },

  /**
   * @param {boolean} enabled
   */
  handleSubtitlesStateUserSet(enabled) {
    this.currentSubtitlesState = enabled

    if (!this.$store.getters.getEnableChannelSettings || !this.$store.getters.getAutoUpdateChannelSubtitlesStates || !this.channelId) {
      return
    }

    this.saveChannelSubtitlesState(enabled)
  },

  /**
   * @param {boolean} enabled
   */
  updateSubtitlesState(enabled) {
    this.currentSubtitlesState = enabled
  },

  /**
   * @param {number} volume
   */
  handleVolumeUserSet(volume) {
    this.currentVolume = volume

    if (!this.$store.getters.getEnableChannelSettings || !this.$store.getters.getAutoUpdateChannelVolumes || !this.channelId) {
      return
    }

    this.saveChannelVolume(volume)
  },

  /**
   * @param {number} volume
   */
  updateVolume(volume) {
    this.currentVolume = volume
  },

  /**
   * @param {boolean} enabled
   */
  saveChannelSubtitlesState(enabled) {
    const states = parseChannelPreferences(this.$store.getters.getChannelSubtitlesStates, 'channelSubtitlesStates')
    states[this.channelId] = enabled
    this.$store.dispatch('updateChannelSubtitlesStates', JSON.stringify(states))
  },

  /**
   * @param {number} volume
   */
  saveChannelVolume(volume) {
    const volumes = parseChannelPreferences(this.$store.getters.getChannelVolumes, 'channelVolumes')
    volumes[this.channelId] = volume
    this.$store.dispatch('updateChannelVolumes', JSON.stringify(volumes))
  },

  /**
   * @param {string | number | null | undefined} quality
   * @returns {string}
   */
  normalizeVideoQuality(quality) {
    const normalizedQuality = quality == null ? '' : String(quality)

    // Auto is broken with SABR, so fall back to the default quality there.
    // The player checks the streams it actually received as well, as yt-dlp
    // can fall back to the built-in extraction method.
    if (normalizedQuality === 'auto' && !playbackEngineSupportsAutoQuality(this.videoPlaybackEngine)) {
      return AUTO_QUALITY_FALLBACK
    }

    return normalizedQuality
  },

  getDefaultVideoQuality() {
    return this.normalizeVideoQuality(this.$store.getters.getDefaultQuality)
  },

  saveChannelPlaybackSpeed(rate) {
    if (!this.channelId) {
      return
    }

    try {
      const channelSpeeds = JSON.parse(this.$store.getters.getChannelPlaybackSpeeds || '{}')
      channelSpeeds[this.channelId] = rate
      this.$store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(channelSpeeds))
    } catch (e) {
      console.error('Failed to save channel playback speed:', e)
    }
  },

  /**
   * @param {string | number | null | undefined} quality
   * @returns {boolean} whether a channel-specific quality was stored
   */
  saveChannelVideoQuality(quality) {
    if (!this.channelId) {
      return false
    }

    try {
      const channelQualities = JSON.parse(this.$store.getters.getChannelVideoQualities || '{}')
      const normalizedQuality = this.normalizeVideoQuality(quality)
      if (normalizedQuality.length === 0) {
        return false
      }

      channelQualities[this.channelId] = normalizedQuality
      this.$store.dispatch('updateChannelVideoQualities', JSON.stringify(channelQualities))
      return true
    } catch (e) {
      console.error('Failed to save channel video quality:', e)
      return false
    }
  },

  initializePlaybackRate() {
    if (this.musicMode) {
      this.currentPlaybackRate = 1
      return
    }

    if (this.sabrReloadState?.playbackRate !== undefined) {
      this.currentPlaybackRate = this.sabrReloadState.playbackRate
      return
    }

    if (this.isMusicVideo) {
      this.currentPlaybackRate = 1
      return
    }

    if (this.channelId && this.$store.getters.getEnableChannelSettings) {
      try {
        const channelSpeeds = JSON.parse(this.$store.getters.getChannelPlaybackSpeeds || '{}')
        if (channelSpeeds[this.channelId] !== undefined) {
          this.currentPlaybackRate = channelSpeeds[this.channelId]
          return
        }
      } catch (e) {
        console.error('Failed to parse channel playback speeds:', e)
      }
    }
    this.currentPlaybackRate = this.$store.getters.getDefaultPlayback
  },

  initializeVideoQuality() {
    if (this.sabrReloadState?.videoQuality) {
      this.currentVideoQuality = this.sabrReloadState.videoQuality
      return
    }

    let quality = this.getDefaultVideoQuality()
    if (this.channelId && this.$store.getters.getEnableChannelSettings) {
      try {
        const channelQualities = JSON.parse(this.$store.getters.getChannelVideoQualities || '{}')
        if (channelQualities[this.channelId] !== undefined) {
          quality = this.normalizeVideoQuality(channelQualities[this.channelId])
        }
      } catch (e) {
        console.error('Failed to parse channel video qualities:', e)
      }
    }

    this.currentVideoQuality = limitQualityOnMeteredNetwork(quality, this.$store.getters.getMeteredNetworkQualityLimit)
  },
}
