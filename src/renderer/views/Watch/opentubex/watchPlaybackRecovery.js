import { MANIFEST_TYPE_SABR } from '../../../helpers/player/SabrManifestParser'
import { showToastOnAllTabs } from '../../../helpers/utils'

// A SABR session can go stale more than once during a long video, so the
// refetch budget is per incident rather than per video: it refills once the
// refreshed stream has played this many seconds, and only bounds reload loops
// where the refreshed stream fails again before it ever settles.
const MAX_SABR_ERROR_RECOVERIES = 3
export const SABR_ERROR_RECOVERY_SETTLE_SECONDS = 30
// timeupdate fires about four times a second, so a natural tick stays well
// under a second even at the fastest playback rate, while the smallest seek
// shortcut jumps 5s. Anything above this is a seek and must not count as played
// content, otherwise seeking around a broken stream would keep handing it fresh
// recovery attempts.
export const SABR_ERROR_RECOVERY_MAX_TICK_SECONDS = 2
// The refill above deliberately has no time limit, so a video that breaks every
// time it has played just past the settle threshold could otherwise reload for
// ever. This is the hard stop for a whole video: once it is spent the format
// fallback runs and the video settles on something that plays.
const MAX_SABR_ERROR_RECOVERIES_PER_VIDEO = 8
const ANDROID_HTTP_ERROR_RETRY_DELAY_MS = 750

/**
 * OpenTubeX stream error recovery: one reload with fresh streaming data, the
 * IP block recovery script, Android's transient HTTP error retry, and the
 * budgeted SABR stream reloads. Spread into the Watch view's `methods`.
 */
export const watchPlaybackRecoveryMethods = {
  async runIpBlockRecoveryScriptAndReload() {
    if (
      !this.ipBlockDetectedInCurrentChain ||
      this.ipBlockRecoveryAttemptedForCurrentVideo ||
      !process.env.IS_ELECTRON
    ) {
      return false
    }

    const scriptPath = this.videoIpBlockScriptPath.trim()
    if (
      scriptPath.length === 0 ||
      typeof window.ftElectron?.startIpBlockRecoveryScript !== 'function' ||
      typeof window.ftElectron?.executeIpBlockRecoveryScript !== 'function'
    ) {
      return false
    }

    const loadGeneration = this.videoLoadGeneration
    const videoId = this.videoId
    this.ipBlockRecoveryAttemptedForCurrentVideo = true
    const longToastDurationMs = 10000
    const startedRecovery = await window.ftElectron.startIpBlockRecoveryScript(scriptPath)
    if (startedRecovery) {
      // IP block recovery affects the whole app (network level), so surface it
      // globally once, from the tab that atomically started the shared run.
      showToastOnAllTabs(this.t('Settings.Proxy Settings.Running IP block recovery script'), longToastDurationMs, ['fas', 'shield-halved'])
    }

    try {
      const result = await window.ftElectron.executeIpBlockRecoveryScript(scriptPath)
      if (startedRecovery && result?.exitCode !== 0) {
        const exitCode = result?.exitCode == null ? 'unknown' : `${result.exitCode}`
        showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script failed', { exitCode }), longToastDurationMs, ['fas', 'circle-exclamation'])
      } else if (startedRecovery) {
        showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script finished'), longToastDurationMs, ['fas', 'check'])
      }
    } catch (error) {
      console.error('IP block recovery script failed:', error)
      if (startedRecovery) {
        showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script failed', { exitCode: 'unknown' }), longToastDurationMs, ['fas', 'circle-exclamation'])
      }
    }

    if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return false

    // The reload only affects this tab's video, so keep it scoped.
    this.showTabToast({
      message: this.t('Settings.Proxy Settings.Reloading video after IP block recovery'),
      time: longToastDurationMs,
      icon: ['fas', 'sync'],
    })
    await this.reloadView()
    return true
  },

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

    const sameVideo = this.videoId === this.tabRoute.params.id
    if (sameVideo) {
      this.setPlayerReloadState(this.$refs.player?.getSabrReloadState())
    }
    await this.reloadView({ preserveTitle: sameVideo })
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

  isSabrVideoStream() {
    return this.activeFormat === 'dash' &&
      this.manifestMimeType === MANIFEST_TYPE_SABR &&
      !this.isLive &&
      !this.isPostLiveDvr
  },

  canReloadSabrStream() {
    return this.isSabrVideoStream() &&
      !this.isLoading &&
      this.sabrErrorRecoveryAttempts < MAX_SABR_ERROR_RECOVERIES &&
      this.sabrErrorRecoveriesForCurrentVideo < MAX_SABR_ERROR_RECOVERIES_PER_VIDEO
  },

  async reloadSabrStream(payload, toastMessage) {
    if (!this.canReloadSabrStream()) {
      if (this.isSabrVideoStream() && !this.isLoading) {
        console.warn(
          `Not reloading the SABR stream for ${this.videoId} after ${this.sabrErrorRecoveryAttempts} reloads ` +
          `since playback last settled and ${this.sabrErrorRecoveriesForCurrentVideo} for this video`
        )
      }
      return false
    }

    // Both critical Shaka errors and SABR's own reload policy mean the
    // current playback session is no longer reusable. Keep them on the same
    // budget so a succession of freshly fetched sessions cannot reload the
    // tab forever without making playback progress.
    this.sabrErrorRecoveryAttempts++
    this.sabrErrorRecoveriesForCurrentVideo++
    this.sabrErrorRecoveryLastSeconds = this.getTimestamp()
    this.sabrErrorRecoveryPlayedSeconds = 0
    console.warn(
      `${toastMessage} for ${this.videoId} at ${this.sabrErrorRecoveryLastSeconds}s and ` +
      `${payload?.playbackRate ?? this.currentPlaybackRate}x speed. Reload ${this.sabrErrorRecoveryAttempts} of ` +
      `${MAX_SABR_ERROR_RECOVERIES} since playback last settled, ${this.sabrErrorRecoveriesForCurrentVideo} of ` +
      `${MAX_SABR_ERROR_RECOVERIES_PER_VIDEO} for this video`
    )
    try {
      await this.performSabrReload(payload, toastMessage)
    } catch (error) {
      console.error('SABR reload failed', error)
      return false
    }
    return true
  },

  async onPlayerReloadRequested(payload) {
    // A request from a player that is already being replaced must not spend
    // the new player's budget or change a format the user selected meanwhile.
    if (!this.isSabrVideoStream() || this.isLoading) { return }

    if (await this.reloadSabrStream(payload, 'Reloading player according to SABR request')) { return }

    this.handleWatchProgressAutoSaveWhenProgressEnabled()
    if (this.legacyFormats.length > 0) {
      console.error('Unable to recover the SABR stream. Reverting to legacy formats...')
      this.enableLegacyFormat()
    } else {
      const timestamp = this.getTimestamp()
      if (timestamp > 0) {
        this.oneTimeTimestamp = timestamp
      }
      this.setPlayerReloadState(payload)
      let fallbackStarted = false
      try {
        fallbackStarted = await this.tryPlaybackEngineFallback({ code: 'SABR_RELOAD' })
      } catch (error) {
        console.error('SABR playback-engine fallback failed', error)
      }
      if (!fallbackStarted) {
        this.errorMessage = '[PLAYER_ERROR: SABR_RELOAD] Unable to recover the video stream. Please reload this video.'
      }
    }
  },

  setPlayerReloadState(payload) {
    const wasPlaying = payload?.wasPlaying === true
    this.resumePlaybackAfterSabrReload = wasPlaying
    this.suppressAutoplayAfterSabrReload = !wasPlaying
    const playbackRate = Number(payload?.playbackRate)
    const restoredPlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0.07
      ? playbackRate
      : this.currentPlaybackRate
    this.sabrReloadState = {
      captionIndex: Number.isInteger(payload?.captionIndex) ? payload.captionIndex : null,
      captionTimingOffset: Number.isFinite(payload?.captionTimingOffset) ? payload.captionTimingOffset : 0,
      localCaptions: Array.isArray(payload?.localCaptions) ? payload.localCaptions : [],
      playbackRate: restoredPlaybackRate,
      videoQuality: this.normalizeVideoQuality(payload?.videoQuality) ||
        this.normalizeVideoQuality(this.currentVideoQuality) || null,
      loopEnabled: payload?.loopEnabled === true,
      abRepeat: {
        start: Number.isFinite(payload?.abRepeat?.start) ? payload.abRepeat.start : null,
        end: Number.isFinite(payload?.abRepeat?.end) ? payload.abRepeat.end : null,
        enabled: payload?.abRepeat?.enabled === true
      },
      repeatStats: payload?.repeatStats ?? null
    }
  },

  async performSabrReload(payload, toastMessage) {
    this.pendingSabrReloadContext = payload?.reloadPlaybackContext
      ? { videoId: this.videoId, context: payload.reloadPlaybackContext }
      : null
    this.setPlayerReloadState(payload)
    this.preserveTitleOnNextReload = true
    this.showTabToast({ message: toastMessage, icon: ['fas', 'sync'] })

    const timestamp = this.getTimestamp()
    if (timestamp > 0) {
      // Reload at the middle should restart at current timestamp
      const reloadLocation = {
        path: this.tabRoute.path,
        query: { ...this.tabRoute.query, oneTimeTimestamp: timestamp },
        // This only carries the resume position for the same video. Keep the
        // resolved title throughout navigation instead of briefly replacing
        // it with the updated watch URL while the metadata reloads.
        state: {
          skipTabRouteLoading: true,
          tabTitle: this.videoTitle,
        },
      }

      if (this.tabRouter.resolve(reloadLocation).fullPath !== this.tabRoute.fullPath) {
        // The route watcher owns this reload. Calling reloadView here as well
        // races two metadata requests and two player teardowns.
        await this.tabRouter.replace(reloadLocation)
        return
      }
    }
    await this.reloadView({ preserveTitle: true })
  },

  onResumePlaybackAfterSabrReloadDone() {
    this.resumePlaybackAfterSabrReload = false
    this.suppressAutoplayAfterSabrReload = false
  },
}
