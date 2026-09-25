import { beginAndroidFullscreenTransition } from '../../helpers/player/androidFullscreenTransition'
import { getVideoThumbnailUrl } from '../../helpers/utils'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'

const MAX_SABR_ERROR_RECOVERIES = 3
const MAX_SABR_ERROR_RECOVERIES_PER_VIDEO = 8

/** Player teardown and SABR reload lifecycle for the Watch view. */
export const watchPlayerLifecycle = {
  destroyPlayer: async function(player = this.$refs.player, preserveFullscreen = true) {
    if (process.env.IS_CAPACITOR && preserveFullscreen && player.isFullscreen) {
      this.finishNativeFullscreenTransition?.()
      this.fullscreenTransitionCancelled = false
      const nextVideoId = this.tabRoute.params.id
      const thumbnail = !nextVideoId || nextVideoId === this.videoId
        ? this.thumbnail
        : getVideoThumbnailUrl(nextVideoId, this.backendPreference, this.currentInvidiousInstanceUrl, this.thumbnailPreference)
      this.finishNativeFullscreenTransition = beginAndroidFullscreenTransition(this.t('Video.Fetching Streams'), thumbnail, () => {
        this.fullscreenTransitionCancelled = true
        this.startNextVideoInFullscreen = false
        this.$refs.player?.cancelPendingFullscreen()
      })
    }
    this.playerTeardownInProgress = true
    try {
      const uiState = await player.destroyPlayer()
      this.startNextVideoInFullscreen = uiState.startNextVideoInFullscreen && !this.fullscreenTransitionCancelled
      this.startNextVideoInFullwindow = uiState.startNextVideoInFullwindow
      this.startNextVideoInPip = uiState.startNextVideoInPip
      this.nextVideoAutoPictureInPictureState = uiState.autoPictureInPictureState
      this.startNextVideoWithChapters = uiState.startNextVideoWithChapters
      this.startNextVideoWithFullscreenMetadata = uiState.startNextVideoWithFullscreenMetadata
      this.startNextVideoWithFullscreenComments = uiState.startNextVideoWithFullscreenComments
      this.startNextVideoWithFullscreenLiveChat = uiState.startNextVideoWithFullscreenLiveChat
      this.startNextVideoWithFullscreenPlaylist = uiState.startNextVideoWithFullscreenPlaylist
    } finally {
      this.playerTeardownInProgress = false
    }
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
    if (!this.canReloadSabrStream()) { return false }

    // Both critical Shaka errors and SABR's own reload policy mean the
    // current playback session is no longer reusable. Keep them on the same
    // budget so a succession of freshly fetched sessions cannot reload the
    // tab forever without making playback progress.
    this.sabrErrorRecoveryAttempts++
    this.sabrErrorRecoveriesForCurrentVideo++
    this.sabrErrorRecoveryLastSeconds = this.getTimestamp()
    this.sabrErrorRecoveryPlayedSeconds = 0
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
      this.errorMessage = '[PLAYER_ERROR: SABR_RELOAD] Unable to recover the video stream. Please reload this video.'
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
  }
}
