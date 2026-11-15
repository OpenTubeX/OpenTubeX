import { computed, ref } from 'vue'

/**
 * Twitch's live playlist only covers the last few seconds, so seeking behind it
 * switches to the recording of the broadcast, and seeking past the end of the
 * recording returns to the live playlist, which has the lowest latency.
 * Both sources report the whole broadcast as their seek range.
 * @param {{
 *   getPlayer: () => import('shaka-player').Player | null,
 *   getControls: () => import('shaka-player').ui.Controls | null,
 *   props: { manifestSrc: string, twitchLiveRecording: { manifestSrc: string, startedAt: number } | null },
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 * }} options
 */
export function useTwitchLiveRewind({ getPlayer, getControls, props, video }) {
  /** @type {import('vue').Ref<'live' | 'recording'>} The source to load */
  const mode = ref('live')
  /** @type {'live' | 'recording' | null} The source Shaka has loaded, null while switching */
  let loadedMode = null
  const manifestSrc = computed(() => mode.value === 'recording' && props.twitchLiveRecording
    ? props.twitchLiveRecording.manifestSrc
    : props.manifestSrc)

  /** The time since the epoch, in ms, at which the live source's timeline starts */
  let liveOrigin = null
  /** How far the live playlist trails the clock, to estimate the live edge in the recording */
  let liveLatencyMs = 0
  /** @type {number | null | undefined} Where the next load starts, null for the live edge */
  let switchStartTime
  let switchCheckScheduled = false
  /** @type {number | null} */
  let requestedTime = null
  /** @type {(() => { start: number, end: number }) | null} */
  let getRealSeekRange = null

  /**
   * Reports the whole broadcast as the seek range, and catches seeks into the
   * part that the other source covers. These would otherwise be clamped,
   * by the media element below 0 and by Shaka outside the real range.
   * @param {import('shaka-player').Player} player
   * @param {HTMLVideoElement} videoElement
   */
  function attach(player, videoElement) {
    if (!props.twitchLiveRecording) return
    const prototype = Object.getPrototypeOf(player)
    const realSeekRange = prototype.seekRange
    getRealSeekRange = () => realSeekRange.call(player)
    const seekRange = () => {
      const range = getRealSeekRange()
      const recording = props.twitchLiveRecording
      if (loadedMode === 'live' && liveOrigin !== null) {
        return { start: Math.min(range.start, (recording.startedAt - liveOrigin) / 1000), end: range.end }
      }
      if (loadedMode === 'recording') {
        return { start: range.start, end: Math.max(range.end, (Date.now() - liveLatencyMs - recording.startedAt) / 1000) }
      }
      return range
    }
    // The compiled Shaka build calls its methods by shortened names, also from the UI
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (Object.getOwnPropertyDescriptor(prototype, name).value === realSeekRange) player[name] = seekRange
    }

    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    Object.defineProperty(videoElement, 'currentTime', {
      configurable: true,
      get() {
        return currentTime.get.call(this)
      },
      set(time) {
        if (!requestSwitch(time)) currentTime.set.call(this, time)
      }
    })
    // WebKit's Media Session seeks use fastSeek
    if (typeof videoElement.fastSeek === 'function') {
      const fastSeek = videoElement.fastSeek
      videoElement.fastSeek = (time) => {
        if (!requestSwitch(time)) fastSeek.call(videoElement, time)
      }
    }
  }

  function handleLoaded() {
    loadedMode = mode.value
  }

  function handleTimeUpdate() {
    const player = getPlayer()
    if (loadedMode !== 'live' || !getRealSeekRange || !player || video.value.seeking) return
    const date = player.getPlayheadTimeAsDate()
    if (!date) return
    liveOrigin = date.getTime() - video.value.currentTime * 1000
    liveLatencyMs = Math.max(0, Date.now() - (liveOrigin + getRealSeekRange().end * 1000))
  }

  /**
   * @param {number} time
   * @returns {boolean} whether the other source covers the time, which then replaces the seek
   */
  function requestSwitch(time) {
    if (!getPlayer() || !Number.isFinite(time)) return false
    const range = getRealSeekRange()
    const switches = (loadedMode === 'live' && liveOrigin !== null && time < range.start - 0.5) ||
      (loadedMode === 'recording' && time > range.end + 0.5)
    // The latest seek wins, also when it returns into the loaded source while dragging
    requestedTime = switches ? time : null
    if (switches && !switchCheckScheduled) {
      switchCheckScheduled = true
      // The seek bar seeks while it is dragged, and resumes playback after letting go
      setTimeout(() => {
        switchCheckScheduled = false
        if (getControls()?.isSeeking() || requestedTime === null || loadedMode === null) return
        const target = requestedTime
        requestedTime = null
        if (loadedMode === 'live') {
          switchStartTime = Math.max(0, (liveOrigin + target * 1000 - props.twitchLiveRecording.startedAt) / 1000)
          switchTo('recording')
        } else {
          switchStartTime = null
          switchTo('live')
        }
      })
    }
    return switches
  }

  /** @param {'live' | 'recording'} newMode */
  function switchTo(newMode) {
    loadedMode = null
    liveOrigin = null
    mode.value = newMode
  }

  /**
   * The start time of a load caused by switching sources, as positions differ between them.
   * @returns {number | null | undefined} undefined when the load keeps the current position
   */
  function takeSwitchStartTime() {
    const time = switchStartTime
    switchStartTime = undefined
    return time
  }

  return { attach, handleLoaded, handleTimeUpdate, manifestSrc, mode, takeSwitchStartTime }
}
