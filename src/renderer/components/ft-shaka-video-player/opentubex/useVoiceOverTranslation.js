import { computed, onBeforeUnmount, ref, watch } from 'vue'

const MAX_VIDEO_DURATION_SECONDS = 4 * 60 * 60
const MIN_POLL_DELAY_SECONDS = 5
const MAX_POLL_DELAY_SECONDS = 60
const PARTIAL_CONTENT_STATUS = 5
const MAX_AUDIO_DRIFT_SECONDS = 0.4

/**
 * Keep a translated audio track synchronized with the player video.
 *
 * @param {{
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 *   videoId: import('vue').ComputedRef<string>,
 *   responseLanguage: import('vue').ComputedRef<'ru' | 'en' | 'kk'>,
 *   autoPrepare: import('vue').ComputedRef<boolean>,
 *   voiceVolume: import('vue').ComputedRef<number>,
 *   onError: (error: unknown) => void
 * }} options
 */
export function useVoiceOverTranslation({ video, videoId, responseLanguage, autoPrepare, voiceVolume, onError }) {
  const state = ref('idle')
  const enabled = ref(false)
  const preparationRequested = ref(false)
  const visibleState = computed(() => {
    return state.value === 'loading' && !preparationRequested.value ? 'idle' : state.value
  })

  /** @type {HTMLAudioElement | null} */
  let audio = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pollTimeout = null
  let requestGeneration = 0
  let enableOnReady = false

  function clearPollTimeout() {
    if (pollTimeout !== null) {
      clearTimeout(pollTimeout)
      pollTimeout = null
    }
  }

  function syncAudioPosition(force = false) {
    const videoElement = video.value
    if (!audio || !videoElement || !Number.isFinite(videoElement.currentTime)) {
      return
    }

    if (force || Math.abs(audio.currentTime - videoElement.currentTime) > MAX_AUDIO_DRIFT_SECONDS) {
      audio.currentTime = videoElement.currentTime
    }
  }

  function syncAudioPlayback() {
    if (!audio || !video.value) {
      return
    }

    if (!enabled.value) {
      audio.pause()
      return
    }

    syncAudioPosition()
    audio.playbackRate = video.value.playbackRate
    audio.volume = Math.min(1, video.value.volume * voiceVolume.value)
    audio.muted = video.value.muted

    if (video.value.paused || video.value.ended) {
      audio.pause()
    } else {
      audio.play().catch(() => {})
    }
  }

  function handleAudioError() {
    enabled.value = false
    state.value = 'error'
    onError(new Error('The translated audio track could not be played'))
  }

  function discardAudio() {
    if (!audio) {
      return
    }

    audio.removeEventListener('error', handleAudioError)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    audio = null
  }

  function setAudioSource(url, shouldEnable) {
    discardAudio()

    audio = new Audio()
    audio.preload = 'auto'
    audio.addEventListener('error', handleAudioError)
    audio.src = url
    state.value = 'ready'
    enabled.value = shouldEnable
    syncAudioPosition(true)
    syncAudioPlayback()
  }

  function schedulePoll(result, generation, preserveReadyTrack = false, enableWhenReady = true) {
    const remainingTime = Number.isFinite(result.remainingTime) ? result.remainingTime : MIN_POLL_DELAY_SECONDS
    const delaySeconds = Math.min(MAX_POLL_DELAY_SECONDS, Math.max(MIN_POLL_DELAY_SECONDS, remainingTime))

    clearPollTimeout()
    pollTimeout = setTimeout(() => {
      requestTranslation(generation, preserveReadyTrack, enableWhenReady)
    }, delaySeconds * 1000)
  }

  async function requestTranslation(
    generation = ++requestGeneration,
    preserveReadyTrack = false,
    enableWhenReady = true
  ) {
    const videoElement = video.value
    if (!videoElement) {
      return
    }

    const duration = videoElement.duration
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION_SECONDS) {
      state.value = 'error'
      onError(new RangeError('Voice-over translation only supports videos up to four hours long'))
      return
    }

    if (!preserveReadyTrack) {
      state.value = 'loading'
    }

    try {
      const result = await window.ftElectron.requestVoiceOverTranslation({
        videoId: videoId.value,
        duration,
        responseLanguage: responseLanguage.value
      })

      if (generation !== requestGeneration) {
        return
      }

      if (result?.translated && typeof result.url === 'string') {
        setAudioSource(
          result.url,
          preserveReadyTrack ? enabled.value : (enableWhenReady || enableOnReady)
        )
        enableOnReady = false

        if (result.status === PARTIAL_CONTENT_STATUS) {
          schedulePoll(result, generation, true, enableWhenReady)
        }
      } else {
        schedulePoll(result ?? {}, generation, preserveReadyTrack, enableWhenReady)
      }
    } catch (error) {
      if (generation !== requestGeneration) {
        return
      }

      if (!preserveReadyTrack) {
        enabled.value = false
        if (enableWhenReady || enableOnReady) {
          state.value = 'error'
          onError(error)
        } else {
          state.value = 'idle'
        }
      }
    }
  }

  function toggle() {
    if (state.value === 'loading') {
      if (preparationRequested.value) {
        requestGeneration++
        enableOnReady = false
        preparationRequested.value = false
        clearPollTimeout()
        state.value = 'idle'
        return
      }

      preparationRequested.value = true
      enableOnReady = true
      return
    }

    if (state.value === 'error') {
      discardAudio()
      preparationRequested.value = true
      enableOnReady = true
      requestTranslation()
      return
    }

    if (audio) {
      enabled.value = !enabled.value
      syncAudioPlayback()
      return
    }

    preparationRequested.value = true
    enableOnReady = true
    requestTranslation()
  }

  function prepare() {
    const duration = video.value?.duration
    if (state.value === 'idle' && !audio && Number.isFinite(duration) &&
        duration > 0 && duration <= MAX_VIDEO_DURATION_SECONDS) {
      requestTranslation(undefined, false, false)
    }
  }

  function reset() {
    requestGeneration++
    enableOnReady = false
    preparationRequested.value = false
    clearPollTimeout()
    enabled.value = false
    state.value = 'idle'
    discardAudio()
  }

  function handlePlay() {
    syncAudioPlayback()
  }

  function handlePause() {
    audio?.pause()
  }

  function handleSeeking() {
    syncAudioPosition(true)
  }

  function handleTimeUpdate() {
    if (enabled.value) {
      syncAudioPosition()
    }
  }

  function handleRateChange() {
    if (audio && video.value) {
      audio.playbackRate = video.value.playbackRate
    }
  }

  function handleVolumeChange() {
    if (audio && video.value) {
      audio.volume = Math.min(1, video.value.volume * voiceVolume.value)
      audio.muted = video.value.muted
    }
  }

  function handleLoadedMetadata() {
    if (autoPrepare.value) {
      prepare()
    }
  }

  function attach(videoElement) {
    videoElement.addEventListener('play', handlePlay)
    videoElement.addEventListener('pause', handlePause)
    videoElement.addEventListener('seeking', handleSeeking)
    videoElement.addEventListener('timeupdate', handleTimeUpdate)
    videoElement.addEventListener('ratechange', handleRateChange)
    videoElement.addEventListener('volumechange', handleVolumeChange)
    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata)
  }

  function detach(videoElement) {
    videoElement.removeEventListener('play', handlePlay)
    videoElement.removeEventListener('pause', handlePause)
    videoElement.removeEventListener('seeking', handleSeeking)
    videoElement.removeEventListener('timeupdate', handleTimeUpdate)
    videoElement.removeEventListener('ratechange', handleRateChange)
    videoElement.removeEventListener('volumechange', handleVolumeChange)
    videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata)
  }

  onBeforeUnmount(() => {
    reset()
    if (video.value) {
      detach(video.value)
    }
  })

  watch(voiceVolume, syncAudioPlayback)

  return {
    state: visibleState,
    enabled,
    attach,
    prepare,
    reset,
    toggle
  }
}
