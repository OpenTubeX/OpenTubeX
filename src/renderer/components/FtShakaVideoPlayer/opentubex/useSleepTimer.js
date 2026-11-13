import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const SLEEP_TIMER_STORAGE_KEY_PREFIX = 'OpenTubeX/sleepTimer'
const SLEEP_TIMER_UPDATE_INTERVAL_MS = 1000
const CHAPTER_END_MARGIN_SECONDS = 0.05

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
 * @param {{ getVideoId: () => string, getCurrentTime: () => number, getPlaybackRate: () => number, isPaused: () => boolean, isSeeking: () => boolean, onExpired: () => void, pausePlayback: () => void, seekTo: (seconds: number) => void, tabId?: string | null }} options
 */
export function useSleepTimer({ getVideoId, getCurrentTime, getPlaybackRate, isPaused, isSeeking, onExpired, pausePlayback, seekTo, tabId = null }) {
  const storageKey = tabId ? `${SLEEP_TIMER_STORAGE_KEY_PREFIX}/${tabId}` : SLEEP_TIMER_STORAGE_KEY_PREFIX
  /** @type {import('vue').Ref<'duration' | 'end-of-video' | 'end-of-chapter' | null>} */
  const mode = ref(null)
  const durationMinutes = ref(null)
  const remainingMs = ref(0)

  let targetVideoId = null
  let targetChapterEndSeconds = null
  let expirationTimeoutId = null
  let chapterTimeoutId = null
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

    if (chapterTimeoutId !== null) {
      clearTimeout(chapterTimeoutId)
      chapterTimeoutId = null
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
    targetChapterEndSeconds = null
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
    if (mode.value === 'end-of-chapter') {
      checkChapterBoundary()
      return
    }

    if (mode.value !== 'duration' || lastRemainingUpdateAt !== null) {
      return
    }

    lastRemainingUpdateAt = Date.now()
    expirationTimeoutId = setTimeout(expireDurationTimer, remainingMs.value)
    remainingIntervalId = setInterval(updateRemainingTime, SLEEP_TIMER_UPDATE_INTERVAL_MS)
  }

  function pauseCountdown() {
    if (chapterTimeoutId !== null) {
      clearTimeout(chapterTimeoutId)
      chapterTimeoutId = null
    }

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
    targetChapterEndSeconds = null

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
    targetChapterEndSeconds = null

    sessionStorage.setItem(storageKey, JSON.stringify({
      mode: mode.value,
      videoId,
    }))
  }

  /** @param {number} endSeconds */
  function startEndOfChapter(endSeconds) {
    const videoId = getVideoId()
    if (videoId === '' || !Number.isFinite(endSeconds) || endSeconds <= getCurrentTime()) {
      return
    }

    clearScheduledUpdates()
    mode.value = 'end-of-chapter'
    durationMinutes.value = null
    remainingMs.value = 0
    targetVideoId = videoId
    targetChapterEndSeconds = endSeconds

    sessionStorage.setItem(storageKey, JSON.stringify({ mode: mode.value, videoId, endSeconds }))
    checkChapterBoundary()
  }

  /** @returns {boolean} Whether the chapter boundary stopped playback. */
  function checkChapterBoundary() {
    if (chapterTimeoutId !== null) {
      clearTimeout(chapterTimeoutId)
      chapterTimeoutId = null
    }

    if (mode.value !== 'end-of-chapter' || isPaused() || isSeeking()) {
      return false
    }

    if (targetVideoId !== getVideoId()) {
      cancel()
      return false
    }

    const stopAt = Math.max(0, targetChapterEndSeconds - CHAPTER_END_MARGIN_SECONDS)
    const secondsLeft = stopAt - getCurrentTime()
    if (secondsLeft <= 0) {
      resetState()
      pausePlayback()
      seekTo(stopAt)
      onExpired()
      return true
    }

    const rate = getPlaybackRate()
    if (Number.isFinite(rate) && rate > 0) {
      chapterTimeoutId = setTimeout(checkChapterBoundary, Math.max(4, secondsLeft / rate * 1000))
    }
    return false
  }

  function handleSeeked() {
    if (mode.value !== 'end-of-chapter') {
      return
    }

    if (getCurrentTime() >= targetChapterEndSeconds) {
      cancel()
    } else {
      checkChapterBoundary()
    }
  }

  function cancel() {
    resetState()
  }

  /**
   * @returns {boolean} Whether autoplay should be suppressed for this video ending.
   */
  function consumeEndOfVideo() {
    if (!['end-of-video', 'end-of-chapter'].includes(mode.value) || targetVideoId !== getVideoId()) {
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

    if (storedTimer?.mode === 'end-of-chapter' &&
      storedTimer.videoId === getVideoId() &&
      Number.isFinite(storedTimer.endSeconds) && storedTimer.endSeconds > 0) {
      mode.value = storedTimer.mode
      targetVideoId = storedTimer.videoId
      targetChapterEndSeconds = storedTimer.endSeconds
      checkChapterBoundary()
      return
    }

    clearStoredTimer()
  }

  watch(getVideoId, (videoId) => {
    if (['end-of-video', 'end-of-chapter'].includes(mode.value) && targetVideoId !== videoId) {
      cancel()
    }
  })

  onMounted(restore)
  onBeforeUnmount(pauseCountdown)

  return {
    cancel,
    consumeEndOfVideo,
    durationMinutes,
    checkChapterBoundary,
    handleSeeked,
    mode,
    pauseCountdown,
    remainingMs,
    resumeCountdown,
    startDuration,
    startEndOfVideo,
    startEndOfChapter,
  }
}
