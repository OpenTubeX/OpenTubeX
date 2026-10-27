import { computed, ref, watch } from 'vue'

export const NORMAL_PLAYBACK_RATE = 1
const TEMPORARY_PLAYBACK_RATE_MULTIPLIER = 2
const TEMPORARY_PLAYBACK_RATE_HOLD_DELAY_MS = 625

/**
 * @param {unknown} rate
 * @returns {number | null}
 */
export function normalizePlaybackRate(rate) {
  const parsedRate = typeof rate === 'number' ? rate : Number(rate)
  return Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null
}

/**
 * Owns the player's playback rate: the rate queued until Shaka can apply it,
 * whether the user chose the current rate, normal speed for music and live
 * videos, the toggle back from normal speed, and holding to play faster.
 * @param {{
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 *   getPlayer: () => shaka.Player | null,
 *   hasLoaded: import('vue').Ref<boolean>,
 *   isLive: import('vue').Ref<boolean>,
 *   musicMode: import('vue').Ref<boolean>,
 *   hasSponsorBlockMusicOfftopicSegment: import('vue').Ref<boolean>,
 *   shortsNavigationSuspended: import('vue').Ref<boolean>,
 *   props: { currentPlaybackRate: unknown, sabrReloadState?: { playbackRate?: unknown } | null, videoIsMusic: boolean },
 *   defaultPlaybackRate: import('vue').Ref<number>,
 *   maxVideoPlaybackRate: import('vue').Ref<number>,
 *   videoPlaybackRateInterval: import('vue').Ref<number>,
 *   savedChannelPlaybackRate: import('vue').Ref<number | null>,
 *   holdToDoublePlaybackSpeed: import('vue').Ref<boolean>,
 *   onPlaybackRateUpdated: (rate: number) => void,
 *   onPlaybackRateUserSet: (rate: number) => void,
 *   updatePendingPlaybackRateMenu: () => void,
 *   showValueChange: (message: string, icons: string, invertContentOrder?: boolean, seekSeconds?: number, revealControls?: boolean) => void,
 *   showToast: (options: { message: string, icon: [string, string] }) => void,
 *   t: (key: string) => string,
 * }} options
 */
export function usePlaybackRate({
  video,
  getPlayer,
  hasLoaded,
  isLive,
  musicMode,
  hasSponsorBlockMusicOfftopicSegment,
  shortsNavigationSuspended,
  props,
  defaultPlaybackRate,
  maxVideoPlaybackRate,
  videoPlaybackRateInterval,
  savedChannelPlaybackRate,
  holdToDoublePlaybackSpeed,
  onPlaybackRateUpdated,
  onPlaybackRateUserSet,
  updatePendingPlaybackRateMenu,
  showValueChange,
  showToast,
  t,
}) {
  /** @type {number | null} */
  let togglePlaybackRate = null

  /** @type {number | null} */
  let pendingPlaybackRateRestore = null

  let playbackRateUserSet = normalizePlaybackRate(props.sabrReloadState?.playbackRate) !== null
  let musicPlaybackRateToastShown = false
  let pendingMusicPlaybackRateToast = false

  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const temporaryPlaybackRateHoldTimeouts = new Map()
  /** @type {Set<string>} */
  const temporaryPlaybackRateSources = new Set()
  /** @type {number | null} */
  let playbackRateBeforeTemporaryPlayback = null
  let wasPausedBeforeTemporaryPlayback = false
  let temporaryPlaybackRateActive = false
  let preserveControlsOnTemporaryPause = false

  const showTemporaryPlaybackRateIndicator = ref(false)
  const temporaryPlaybackRateIndicatorMessage = ref('')

  const isMusicVideoDetected = computed(() => {
    return props.videoIsMusic || hasSponsorBlockMusicOfftopicSegment.value
  })

  const shouldUseNormalPlaybackRateByDefault = computed(() => musicMode.value || isLive.value || isMusicVideoDetected.value)

  /**
   * @param {number} fallbackPlaybackRate
   * @returns {number}
   */
  function getDefaultPlaybackRateForVideo(fallbackPlaybackRate = defaultPlaybackRate.value) {
    return shouldUseNormalPlaybackRateByDefault.value ? NORMAL_PLAYBACK_RATE : fallbackPlaybackRate
  }

  /**
   * @returns {number}
   */
  function getInitialPlaybackRate() {
    if (playbackRateUserSet && pendingPlaybackRateRestore !== null) {
      return pendingPlaybackRateRestore
    }

    if (musicMode.value) return NORMAL_PLAYBACK_RATE

    const sabrReloadPlaybackRate = normalizePlaybackRate(props.sabrReloadState?.playbackRate)
    if (sabrReloadPlaybackRate !== null) {
      return sabrReloadPlaybackRate
    }

    if (!playbackRateUserSet && shouldUseNormalPlaybackRateByDefault.value) {
      return NORMAL_PLAYBACK_RATE
    }

    return normalizePlaybackRate(props.currentPlaybackRate) ?? NORMAL_PLAYBACK_RATE
  }

  /**
   * @returns {number}
   */
  function getUnforcedPlaybackRate() {
    if (savedChannelPlaybackRate.value !== null) {
      return savedChannelPlaybackRate.value
    }

    const currentPlaybackRate = normalizePlaybackRate(props.currentPlaybackRate)
    if (currentPlaybackRate !== null && Math.abs(currentPlaybackRate - NORMAL_PLAYBACK_RATE) >= 0.01) {
      return currentPlaybackRate
    }

    return defaultPlaybackRate.value
  }

  /**
   * @param {number|null} unforcedPlaybackRate
   */
  function showMusicPlaybackRateToast(unforcedPlaybackRate) {
    if (
      musicPlaybackRateToastShown ||
      playbackRateUserSet ||
      !isMusicVideoDetected.value ||
      unforcedPlaybackRate === null ||
      Math.abs(unforcedPlaybackRate - NORMAL_PLAYBACK_RATE) < 0.01
    ) {
      return
    }

    // Defer the toast until the video is actually played in this tab, so it
    // doesn't pop up in whatever tab happened to be open when the video loaded.
    pendingMusicPlaybackRateToast = true
  }

  function flushPendingMusicPlaybackRateToast() {
    if (!pendingMusicPlaybackRateToast || musicPlaybackRateToastShown || playbackRateUserSet) {
      return
    }

    pendingMusicPlaybackRateToast = false
    showToast({ message: t('Video.Player.MusicPlaybackRateOverride'), icon: ['fas', 'gauge'] })
    musicPlaybackRateToastShown = true
  }

  /**
   * @returns {number | null}
   */
  function getCurrentPlaybackRate() {
    if (!hasLoaded.value) {
      return pendingPlaybackRateRestore ?? getInitialPlaybackRate()
    }

    if (temporaryPlaybackRateActive && playbackRateBeforeTemporaryPlayback !== null) {
      return playbackRateBeforeTemporaryPlayback
    }

    const playerRate = normalizePlaybackRate(getPlayer()?.getPlaybackRate())
    if (playerRate !== null) {
      return playerRate
    }

    const videoRate = normalizePlaybackRate(video.value?.playbackRate)
    if (videoRate !== null) {
      return videoRate
    }

    return normalizePlaybackRate(props.currentPlaybackRate)
  }

  /**
   * The rate a reloaded source should start at: the queued one, or else the current one.
   * @returns {number | null}
   */
  function getPlaybackRateToRestore() {
    return pendingPlaybackRateRestore ?? getCurrentPlaybackRate()
  }

  /**
   * Whether Shaka can't apply a rate yet, so the player must keep it until loading finishes.
   * @returns {boolean}
   */
  function isPlaybackRateRestoreQueued() {
    return !hasLoaded.value || pendingPlaybackRateRestore !== null
  }

  /**
   * @param {number|null|undefined} rate
   */
  function queuePlaybackRateRestore(rate = getCurrentPlaybackRate()) {
    pendingPlaybackRateRestore = normalizePlaybackRate(rate)
  }

  function restorePendingPlaybackRate() {
    const player = getPlayer()
    const playbackRate = pendingPlaybackRateRestore ?? getInitialPlaybackRate()
    pendingPlaybackRateRestore = null

    if (playbackRate === null || !video.value || !player) {
      return
    }

    video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo()

    try {
      if (Math.abs(playbackRate - video.value.defaultPlaybackRate) < 0.01) {
        player.cancelTrickPlay()
      } else {
        player.trickPlay(playbackRate, false)
      }
    } catch (error) {
      console.error('Failed to restore playback rate:', error)
    }
  }

  /**
   * @param {string} source
   */
  function activateTemporaryPlaybackRate(source) {
    const player = getPlayer()
    if (!player || !video.value || !hasLoaded.value) {
      return
    }

    temporaryPlaybackRateSources.add(source)

    if (temporaryPlaybackRateActive) {
      return
    }

    const playbackRate = getCurrentPlaybackRate()
    if (playbackRate === null) {
      temporaryPlaybackRateSources.delete(source)
      return
    }

    playbackRateBeforeTemporaryPlayback = playbackRate
    wasPausedBeforeTemporaryPlayback = video.value.paused
    temporaryPlaybackRateActive = true

    try {
      const temporaryPlaybackRate = playbackRate * TEMPORARY_PLAYBACK_RATE_MULTIPLIER
      player.trickPlay(temporaryPlaybackRate, false)
      temporaryPlaybackRateIndicatorMessage.value = `${Number.parseFloat(temporaryPlaybackRate.toFixed(2))}x`
      showTemporaryPlaybackRateIndicator.value = true
      if (wasPausedBeforeTemporaryPlayback) {
        video.value.play()
      }
    } catch (error) {
      temporaryPlaybackRateSources.delete(source)
      playbackRateBeforeTemporaryPlayback = null
      wasPausedBeforeTemporaryPlayback = false
      temporaryPlaybackRateActive = false
      showTemporaryPlaybackRateIndicator.value = false
      console.error('Failed to apply temporary playback rate:', error)
    }
  }

  /**
   * Plays faster once the source has been held long enough.
   * @param {string} source what is being held, such as the keyboard or a pointer
   */
  function startTemporaryPlaybackRateHold(source) {
    if (
      !getPlayer() ||
      !video.value ||
      !hasLoaded.value ||
      !holdToDoublePlaybackSpeed.value ||
      temporaryPlaybackRateHoldTimeouts.has(source) ||
      temporaryPlaybackRateSources.has(source)
    ) {
      return
    }

    const timeoutId = setTimeout(() => {
      temporaryPlaybackRateHoldTimeouts.delete(source)
      activateTemporaryPlaybackRate(source)
    }, TEMPORARY_PLAYBACK_RATE_HOLD_DELAY_MS)

    temporaryPlaybackRateHoldTimeouts.set(source, timeoutId)
  }

  function restoreTemporaryPlaybackRate() {
    if (!temporaryPlaybackRateActive) {
      return
    }

    const player = getPlayer()
    const playbackRate = playbackRateBeforeTemporaryPlayback

    try {
      if (playbackRate !== null) {
        if (Math.abs(playbackRate - getDefaultPlaybackRateForVideo()) < 0.01) {
          player?.cancelTrickPlay()
        } else {
          player?.trickPlay(playbackRate, false)
        }
      }

      if (wasPausedBeforeTemporaryPlayback && video.value && !video.value.paused) {
        preserveControlsOnTemporaryPause = true
        video.value.pause()
      }
    } catch (error) {
      console.error('Failed to restore playback after temporary playback rate:', error)
    } finally {
      playbackRateBeforeTemporaryPlayback = null
      wasPausedBeforeTemporaryPlayback = false
      temporaryPlaybackRateActive = false
      showTemporaryPlaybackRateIndicator.value = false
    }
  }

  /**
   * @param {string} source
   */
  function finishTemporaryPlaybackRateHold(source) {
    const timeoutId = temporaryPlaybackRateHoldTimeouts.get(source)
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      temporaryPlaybackRateHoldTimeouts.delete(source)
    }

    temporaryPlaybackRateSources.delete(source)
    if (temporaryPlaybackRateSources.size === 0) {
      restoreTemporaryPlaybackRate()
    }
  }

  function cancelTemporaryPlaybackRateHolds() {
    temporaryPlaybackRateHoldTimeouts.forEach(timeoutId => clearTimeout(timeoutId))
    temporaryPlaybackRateHoldTimeouts.clear()
    temporaryPlaybackRateSources.clear()
    restoreTemporaryPlaybackRate()
  }

  /** Whether a hold is playing faster, which doesn't change the chosen rate. */
  function isTemporaryPlaybackRateActive() {
    return temporaryPlaybackRateActive
  }

  /**
   * @param {string} source
   * @returns {boolean} whether holding the source has sped up playback
   */
  function isTemporaryPlaybackRateSourceActive(source) {
    return temporaryPlaybackRateSources.has(source)
  }

  /**
   * @param {string} source
   * @returns {boolean} whether the source is held but hasn't sped up playback yet
   */
  function isTemporaryPlaybackRateHoldPending(source) {
    return temporaryPlaybackRateHoldTimeouts.has(source)
  }

  /**
   * Whether the latest pause came from ending a hold that started while paused,
   * which shouldn't reveal the controls. Answers once per pause.
   * @returns {boolean}
   */
  function consumeTemporaryPlaybackRatePause() {
    const preserveControls = preserveControlsOnTemporaryPause
    preserveControlsOnTemporaryPause = false
    return preserveControls
  }

  watch(
    () => props.currentPlaybackRate,
    (playbackRate) => {
      if (hasLoaded.value) {
        return
      }

      if (normalizePlaybackRate(playbackRate) === null) {
        return
      }

      queuePlaybackRateRestore(getInitialPlaybackRate())

      setVideoPlaybackRate(getInitialPlaybackRate())
    }
  )

  watch(shouldUseNormalPlaybackRateByDefault, (shouldUseNormalPlaybackRate) => {
    const unforcedPlaybackRate = getCurrentPlaybackRate()

    if (video.value) {
      video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo()
    }

    if (!shouldUseNormalPlaybackRate || playbackRateUserSet) {
      return
    }

    queuePlaybackRateRestore(NORMAL_PLAYBACK_RATE)
    showMusicPlaybackRateToast(unforcedPlaybackRate)

    const player = getPlayer()
    if (!hasLoaded.value || !player || !video.value) {
      if (video.value) {
        video.value.playbackRate = NORMAL_PLAYBACK_RATE
      }
      return
    }

    try {
      player.cancelTrickPlay()
    } catch (error) {
      console.error('Failed to apply normal playback rate default:', error)
    }
  })

  function applyMusicModePlaybackRate() {
    cancelTemporaryPlaybackRateHolds()
    playbackRateUserSet = false
    togglePlaybackRate = null
    const rate = shouldUseNormalPlaybackRateByDefault.value
      ? NORMAL_PLAYBACK_RATE
      : savedChannelPlaybackRate.value ?? defaultPlaybackRate.value
    queuePlaybackRateRestore(rate)
    if (hasLoaded.value) {
      restorePendingPlaybackRate()
    } else {
      setVideoPlaybackRate(rate)
    }
    if (!shortsNavigationSuspended.value) {
      onPlaybackRateUpdated(rate)
    }
  }

  watch(musicMode, applyMusicModePlaybackRate)

  /**
   * @param {number} rate
   */
  function setVideoPlaybackRate(rate) {
    if (!video.value) return
    try {
      video.value.playbackRate = rate
    } catch (error) {
      // Shaka can emulate speeds outside the browser's native range once loaded.
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError') throw error
    }
  }

  /**
   * @param {number} rate
   */
  function setPlaybackRate(rate) {
    playbackRateUserSet = true

    // A replacement source may be waiting for availability while the current
    // one is still loaded. Keep its queued restore synced with newer choices.
    if (isPlaybackRateRestoreQueued()) {
      queuePlaybackRateRestore(rate)
    }

    if (!hasLoaded.value) {
      // Shaka's rate controller may not exist yet. Preserve the choice for
      // handleLoaded and update the media element and quick bar immediately.
      setVideoPlaybackRate(rate)
      updatePendingPlaybackRateMenu()
    } else if (Math.abs(rate - getDefaultPlaybackRateForVideo()) < 0.01) {
      getPlayer().cancelTrickPlay()
    } else {
      getPlayer().trickPlay(rate, false)
    }

    onPlaybackRateUpdated(rate)
    onPlaybackRateUserSet(rate)
  }

  /**
   * Records a rate the user chose in Shaka's own menu, which Shaka applies itself.
   */
  function handlePlayerMenuPlaybackRateSelected() {
    playbackRateUserSet = true
    setTimeout(() => {
      const player = getPlayer()
      if (!player) {
        return
      }

      onPlaybackRateUserSet(player.getPlaybackRate())
    }, 10)
  }

  /**
   * @param {number} rate
   * @param {boolean} revealControls Whether the change should reveal the player controls
   */
  function applyPlaybackRate(rate, revealControls = true) {
    const newPlaybackRateString = rate.toFixed(2)
    const newPlaybackRate = parseFloat(newPlaybackRateString)

    // The following error is thrown if you go below 0.07:
    // The provided playback rate (0.05) is not in the supported playback range.
    if (newPlaybackRate > 0.07 && newPlaybackRate <= maxVideoPlaybackRate.value) {
      setPlaybackRate(newPlaybackRate)
      showValueChange(`${newPlaybackRateString}x`, 'gauge', false, 0, revealControls)
    }
  }

  /**
   * @param {number} delta
   * @param {boolean} snapToClosestInterval Whether to move along the playback rate slider's interval steps
   */
  function changePlayBackRate(delta, snapToClosestInterval = false) {
    const currentPlaybackRate = getCurrentPlaybackRate() ?? NORMAL_PLAYBACK_RATE

    if (!snapToClosestInterval) {
      applyPlaybackRate(currentPlaybackRate + delta)
      return
    }

    applyPlaybackRate(getSteppedPlaybackRate(currentPlaybackRate, delta))
  }

  /**
   * Moves along the playback rate slider's interval steps, like its - and + buttons.
   * @param {number} currentPlaybackRate
   * @param {number} delta
   * @returns {number}
   */
  function getSteppedPlaybackRate(currentPlaybackRate, delta) {
    // Modified from https://github.com/shaka-project/shaka-player/blob/v5.3.2/ui/playback_rate_selection.js#L206-L221
    // Rates between two steps snap towards the direction of the change,
    // so the next step is never skipped.
    const step = videoPlaybackRateInterval.value
    const snapped = Math.round(currentPlaybackRate / step + (delta < 0 ? 0.001 : -0.001)) * step
    // Eliminate floating-point noise (e.g. 0.05 * 20 → 1.0000000000000002).
    const next = parseFloat((Math.round((snapped + delta) / step) * step).toPrecision(10))
    return Math.max(step, Math.min(maxVideoPlaybackRate.value, next))
  }

  /**
   * @param {number} rate
   */
  function isNormalPlaybackRate(rate) {
    return Math.abs(rate - NORMAL_PLAYBACK_RATE) < 0.01
  }

  function toggleNormalPlaybackRate() {
    const currentRate = getCurrentPlaybackRate()

    if (!isNormalPlaybackRate(currentRate)) {
      togglePlaybackRate = currentRate
      applyPlaybackRate(NORMAL_PLAYBACK_RATE)
    } else if (togglePlaybackRate != null) {
      applyPlaybackRate(togglePlaybackRate)
    }
  }

  return {
    showTemporaryPlaybackRateIndicator,
    temporaryPlaybackRateIndicatorMessage,
    isMusicVideoDetected,
    getDefaultPlaybackRateForVideo,
    getInitialPlaybackRate,
    getUnforcedPlaybackRate,
    showMusicPlaybackRateToast,
    flushPendingMusicPlaybackRateToast,
    getCurrentPlaybackRate,
    getPlaybackRateToRestore,
    isPlaybackRateRestoreQueued,
    queuePlaybackRateRestore,
    restorePendingPlaybackRate,
    startTemporaryPlaybackRateHold,
    finishTemporaryPlaybackRateHold,
    cancelTemporaryPlaybackRateHolds,
    isTemporaryPlaybackRateActive,
    isTemporaryPlaybackRateSourceActive,
    isTemporaryPlaybackRateHoldPending,
    consumeTemporaryPlaybackRatePause,
    applyMusicModePlaybackRate,
    setVideoPlaybackRate,
    setPlaybackRate,
    handlePlayerMenuPlaybackRateSelected,
    applyPlaybackRate,
    changePlayBackRate,
    getSteppedPlaybackRate,
    toggleNormalPlaybackRate,
  }
}
