import { ref } from 'vue'

const SCROLL_MINI_PLAY_PAUSE_HIDE_MS = 3000
const SCROLL_MINI_VOLUME_HIDE_MS = 1000
const SCROLL_MINI_POINTER_REVEAL_SUPPRESS_MS = 250
const SCROLL_MINI_POINTER_REVEAL_MIN_DISTANCE = 8

/**
 * Shows and hides the scroll mini-player's play/pause button and volume popup.
 * During playback they hide after a delay and come back on hover or when the
 * pointer moves over the player.
 *
 * @param {{
 *   scrollMiniPlayerActive: import('vue').Ref<boolean>,
 *   video: import('vue').Ref<HTMLVideoElement | null>
 * }} options
 */
export function useScrollMiniPlayerControls({ scrollMiniPlayerActive, video }) {
  const scrollMiniPlayPauseVisible = ref(true)
  const scrollMiniVolumeExpanded = ref(false)

  /** @type {number | null} */
  let scrollMiniPlayPauseHideTimeout = null
  /** @type {number | null} */
  let scrollMiniVolumeHideTimeout = null
  let scrollMiniPlayPauseHiddenByTimer = false
  let scrollMiniPointerRevealSuppressedUntil = 0
  /** @type {number | null} */
  let scrollMiniPointerRevealSampleX = null
  /** @type {number | null} */
  let scrollMiniPointerRevealSampleY = null

  function clearScrollMiniPlayPauseHideTimeout() {
    if (scrollMiniPlayPauseHideTimeout != null) {
      clearTimeout(scrollMiniPlayPauseHideTimeout)
      scrollMiniPlayPauseHideTimeout = null
    }
  }

  function clearScrollMiniVolumeHideTimeout() {
    if (scrollMiniVolumeHideTimeout != null) {
      clearTimeout(scrollMiniVolumeHideTimeout)
      scrollMiniVolumeHideTimeout = null
    }
  }

  function showScrollMiniVolume() {
    clearScrollMiniVolumeHideTimeout()
    scrollMiniVolumeExpanded.value = true
  }

  function scheduleScrollMiniVolumeHide() {
    clearScrollMiniVolumeHideTimeout()

    scrollMiniVolumeHideTimeout = window.setTimeout(() => {
      scrollMiniVolumeHideTimeout = null
      scrollMiniVolumeExpanded.value = false
    }, SCROLL_MINI_VOLUME_HIDE_MS)
  }

  function hideScrollMiniPlayPause() {
    clearScrollMiniPlayPauseHideTimeout()
    scrollMiniPlayPauseVisible.value = false
    scrollMiniPlayPauseHiddenByTimer = true
  }

  function scheduleScrollMiniPlayPauseHide() {
    clearScrollMiniPlayPauseHideTimeout()

    const videoElement = video.value
    if (!videoElement || videoElement.paused) {
      return
    }

    scrollMiniPlayPauseHideTimeout = window.setTimeout(() => {
      scrollMiniPlayPauseHideTimeout = null

      if (video.value && !video.value.paused) {
        hideScrollMiniPlayPause()
      }
    }, SCROLL_MINI_PLAY_PAUSE_HIDE_MS)
  }

  /** @param {boolean} [autoHide] */
  function showScrollMiniPlayPause(autoHide = false) {
    scrollMiniPlayPauseVisible.value = true
    scrollMiniPlayPauseHiddenByTimer = false
    clearScrollMiniPlayPauseHideTimeout()

    if (autoHide) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function canRevealScrollMiniPlayPauseFromPointer() {
    return performance.now() >= scrollMiniPointerRevealSuppressedUntil
  }

  function suppressScrollMiniPlayPausePointerReveal() {
    scrollMiniPointerRevealSuppressedUntil = performance.now() + SCROLL_MINI_POINTER_REVEAL_SUPPRESS_MS
  }

  /** @param {MouseEvent | FocusEvent} event */
  function handleScrollMiniPlayerLeave(event) {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    const currentTarget = event.currentTarget
    const relatedTarget = event.relatedTarget
    if (
      currentTarget instanceof Node &&
      relatedTarget instanceof Node &&
      currentTarget.contains(relatedTarget)
    ) {
      return
    }

    scrollMiniPointerRevealSampleX = null
    scrollMiniPointerRevealSampleY = null

    if (scrollMiniPlayPauseVisible.value) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function handleScrollMiniPlayerEnter() {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    clearScrollMiniPlayPauseHideTimeout()

    if (scrollMiniPlayPauseVisible.value) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function handleScrollMiniPlayPauseMouseEnter() {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    showScrollMiniPlayPause(true)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniControlsPointerMove(event) {
    const videoElement = video.value
    if (!scrollMiniPlayerActive.value || !videoElement || videoElement.paused) return
    if (scrollMiniPlayPauseVisible.value) return
    if (!canRevealScrollMiniPlayPauseFromPointer()) return
    if (event.pointerType === 'mouse' && event.buttons !== 0) return

    if (scrollMiniPointerRevealSampleX == null || scrollMiniPointerRevealSampleY == null) {
      scrollMiniPointerRevealSampleX = event.clientX
      scrollMiniPointerRevealSampleY = event.clientY
      return
    }

    const dx = event.clientX - scrollMiniPointerRevealSampleX
    const dy = event.clientY - scrollMiniPointerRevealSampleY
    scrollMiniPointerRevealSampleX = event.clientX
    scrollMiniPointerRevealSampleY = event.clientY

    if (Math.hypot(dx, dy) < SCROLL_MINI_POINTER_REVEAL_MIN_DISTANCE) return

    showScrollMiniPlayPause(true)
  }

  // Activation keeps the button hidden when playback had already hidden it.
  function restoreScrollMiniPlayPause() {
    if (scrollMiniPlayPauseHiddenByTimer) {
      scrollMiniPlayPauseVisible.value = false
    } else {
      showScrollMiniPlayPause(true)
    }
  }

  function resetScrollMiniPlayPause() {
    scrollMiniPlayPauseHiddenByTimer = false
    clearScrollMiniPlayPauseHideTimeout()
  }

  return {
    scrollMiniPlayPauseVisible,
    scrollMiniVolumeExpanded,
    clearScrollMiniPlayPauseHideTimeout,
    clearScrollMiniVolumeHideTimeout,
    showScrollMiniVolume,
    scheduleScrollMiniVolumeHide,
    showScrollMiniPlayPause,
    suppressScrollMiniPlayPausePointerReveal,
    handleScrollMiniPlayerLeave,
    handleScrollMiniPlayerEnter,
    handleScrollMiniPlayPauseMouseEnter,
    handleScrollMiniControlsPointerMove,
    restoreScrollMiniPlayPause,
    resetScrollMiniPlayPause,
  }
}
