import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const SLEEP_TIMER_STORAGE_KEY_PREFIX = 'OpenTubeX/sleepTimer'
const SLEEP_TIMER_UPDATE_INTERVAL_MS = 1000

export const SLEEP_TIMER_DURATIONS_MINUTES = [5, 10, 15, 20, 30, 45, 60]

/**
 * @param {number} remainingMs
 * @returns {string}
 */
export function formatSleepTimerRemaining(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * @param {{ getVideoId: () => string, isPaused: () => boolean, onExpired: () => void, pausePlayback: () => void, tabId?: string | null }} options
 */
export function useSleepTimer({ getVideoId, isPaused, onExpired, pausePlayback, tabId = null }) {
  const storageKey = tabId ? `${SLEEP_TIMER_STORAGE_KEY_PREFIX}/${tabId}` : SLEEP_TIMER_STORAGE_KEY_PREFIX
  /** @type {import('vue').Ref<'duration' | 'end-of-video' | null>} */
  const mode = ref(null)
  const durationMinutes = ref(null)
  const remainingMs = ref(0)

  let targetVideoId = null
  let expirationTimeoutId = null
  let remainingIntervalId = null
  let lastRemainingUpdateAt = null

  function clearScheduledUpdates() {
    if (expirationTimeoutId !== null) {
      clearTimeout(expirationTimeoutId)
      expirationTimeoutId = null
    }

    if (remainingIntervalId !== null) {
      clearInterval(remainingIntervalId)
      remainingIntervalId = null
    }

    lastRemainingUpdateAt = null
  }

  function clearStoredTimer() {
    sessionStorage.removeItem(storageKey)
  }

  function resetState() {
    clearScheduledUpdates()
    mode.value = null
    durationMinutes.value = null
    remainingMs.value = 0
    targetVideoId = null
    clearStoredTimer()
  }

  function expireDurationTimer() {
    if (mode.value !== 'duration') {
      return
    }

    resetState()
    pausePlayback()
    onExpired()
  }

  function updateRemainingTime() {
    if (mode.value !== 'duration' || lastRemainingUpdateAt === null) {
      return
    }

    const now = Date.now()
    remainingMs.value = Math.max(0, remainingMs.value - (now - lastRemainingUpdateAt))
    lastRemainingUpdateAt = now

    if (remainingMs.value === 0) {
      expireDurationTimer()
    } else {
      storeDurationTimer()
    }
  }

  function storeDurationTimer() {
    sessionStorage.setItem(storageKey, JSON.stringify({
      mode: mode.value,
      durationMinutes: durationMinutes.value,
      remainingMs: remainingMs.value,
    }))
  }

  function resumeCountdown() {
    if (mode.value !== 'duration' || lastRemainingUpdateAt !== null) {
      return
    }

    lastRemainingUpdateAt = Date.now()
    expirationTimeoutId = setTimeout(expireDurationTimer, remainingMs.value)
    remainingIntervalId = setInterval(updateRemainingTime, SLEEP_TIMER_UPDATE_INTERVAL_MS)
  }

  function pauseCountdown() {
    if (mode.value !== 'duration') {
      return
    }

    updateRemainingTime()
    if (mode.value !== 'duration') {
      return
    }

    clearScheduledUpdates()
    storeDurationTimer()
  }

  /** @param {number} minutes */
  function startDuration(minutes) {
    if (!SLEEP_TIMER_DURATIONS_MINUTES.includes(minutes)) {
      return
    }

    mode.value = 'duration'
    durationMinutes.value = minutes
    remainingMs.value = minutes * 60 * 1000
    targetVideoId = null

    clearScheduledUpdates()
    storeDurationTimer()

    if (!isPaused()) {
      resumeCountdown()
    }
  }

  function startEndOfVideo() {
    const videoId = getVideoId()
    if (videoId === '') {
      return
    }

    clearScheduledUpdates()
    mode.value = 'end-of-video'
    durationMinutes.value = null
    remainingMs.value = 0
    targetVideoId = videoId

    sessionStorage.setItem(storageKey, JSON.stringify({
      mode: mode.value,
      videoId,
    }))
  }

  function cancel() {
    resetState()
  }

  /**
   * @returns {boolean} Whether autoplay should be suppressed for this video ending.
   */
  function consumeEndOfVideo() {
    if (mode.value !== 'end-of-video' || targetVideoId !== getVideoId()) {
      return false
    }

    resetState()
    onExpired()
    return true
  }

  function restore() {
    let storedTimer

    try {
      storedTimer = JSON.parse(sessionStorage.getItem(storageKey))
    } catch {
      clearStoredTimer()
      return
    }

    if (
      storedTimer?.mode === 'duration' &&
      SLEEP_TIMER_DURATIONS_MINUTES.includes(storedTimer.durationMinutes) &&
      (Number.isFinite(storedTimer.remainingMs) || Number.isFinite(storedTimer.endsAt))
    ) {
      const restoredRemainingMs = Number.isFinite(storedTimer.remainingMs)
        ? storedTimer.remainingMs
        : Math.max(0, storedTimer.endsAt - Date.now())

      if (restoredRemainingMs <= 0) {
        clearStoredTimer()
        return
      }

      mode.value = storedTimer.mode
      durationMinutes.value = storedTimer.durationMinutes
      remainingMs.value = restoredRemainingMs
      storeDurationTimer()

      if (!isPaused()) {
        resumeCountdown()
      }
      return
    }

    if (storedTimer?.mode === 'end-of-video' && storedTimer.videoId === getVideoId()) {
      mode.value = storedTimer.mode
      targetVideoId = storedTimer.videoId
      return
    }

    clearStoredTimer()
  }

  watch(getVideoId, (videoId) => {
    if (mode.value === 'end-of-video' && targetVideoId !== videoId) {
      cancel()
    }
  })

  onMounted(restore)
  onBeforeUnmount(pauseCountdown)

  return {
    cancel,
    consumeEndOfVideo,
    durationMinutes,
    mode,
    pauseCountdown,
    remainingMs,
    resumeCountdown,
    startDuration,
    startEndOfVideo,
  }
}
