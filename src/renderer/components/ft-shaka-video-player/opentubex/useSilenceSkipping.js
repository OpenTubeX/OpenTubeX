import { onBeforeUnmount, onMounted, watch } from 'vue'

const ANALYSER_FFT_SIZE = 1024
const FALLBACK_THRESHOLD_DB = -40
const HYSTERESIS_DB = 3
const LOOKAHEAD_SECONDS = 0.06
const MAX_HISTORY_SAMPLES = 600
const MIN_HISTORY_SAMPLES = 60
const SILENCE_HOLD_MS = 500
const SPEED_RAMP_MS = 200

/**
 * Detects sustained silence and temporarily accelerates playback without
 * changing the speed selected by the user.
 *
 * @param {object} options
 * @param {import('vue').ComputedRef<boolean>} options.enabled
 * @param {import('vue').Ref<boolean>} options.isLive
 * @param {import('vue').Ref<HTMLVideoElement | null>} options.video
 */
export function useSilenceSkipping({ enabled, isLive, video }) {
  /** @type {AudioContext | null} */
  let audioContext = null
  /** @type {AnalyserNode | null} */
  let analyser = null
  /** @type {DelayNode | null} */
  let delay = null
  /** @type {GainNode | null} */
  let gain = null
  /** @type {Float32Array | null} */
  let samples = null
  /** @type {number | null} */
  let animationFrame = null
  /** @type {number | null} */
  let controlledPlaybackRate = null
  /** @type {number | null} */
  let controlledPlaybackRateTimeout = null
  /** @type {number | null} */
  let normalPlaybackRate = null
  let graphSetupPromise = null
  let destroyed = false
  let suspended = false
  let isSilent = false
  let isAccelerating = false
  let lastSampleTime = 0
  let silenceDuration = 0
  let dynamicThresholdDb = FALLBACK_THRESHOLD_DB
  let samplesUntilThresholdUpdate = 0
  const volumeHistory = []

  function shouldRun() {
    const videoElement = video.value
    return !destroyed && !suspended && enabled.value && !isLive.value && videoElement &&
      !videoElement.paused && !videoElement.ended && !videoElement.muted && videoElement.volume > 0 &&
      !videoElement.seeking && videoElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
  }

  function setControlledPlaybackRate(rate) {
    const videoElement = video.value
    if (!videoElement || Math.abs(videoElement.playbackRate - rate) < 0.01) {
      return
    }

    controlledPlaybackRate = rate
    if (controlledPlaybackRateTimeout !== null) {
      clearTimeout(controlledPlaybackRateTimeout)
    }
    controlledPlaybackRateTimeout = window.setTimeout(() => {
      controlledPlaybackRate = null
      controlledPlaybackRateTimeout = null
    }, 100)
    videoElement.playbackRate = rate
  }

  function restoreGain() {
    if (!gain) {
      return
    }

    const now = gain.context.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(1, now + 0.04)
  }

  function resetDetection() {
    lastSampleTime = 0
    silenceDuration = 0
    isSilent = false

    if (isAccelerating && normalPlaybackRate !== null) {
      setControlledPlaybackRate(normalPlaybackRate)
    }

    isAccelerating = false
    restoreGain()
  }

  function stop() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }

    if (delay) {
      delay.delayTime.value = 0
    }

    resetDetection()
  }

  function updateDynamicThreshold(volumeDb) {
    if (Number.isFinite(volumeDb)) {
      volumeHistory.push(volumeDb)
      if (volumeHistory.length > MAX_HISTORY_SAMPLES) {
        volumeHistory.shift()
      }
    }

    samplesUntilThresholdUpdate--
    if (volumeHistory.length < MIN_HISTORY_SAMPLES || samplesUntilThresholdUpdate > 0) {
      return
    }

    samplesUntilThresholdUpdate = 30
    const sortedHistory = [...volumeHistory].sort((a, b) => a - b)
    const noiseFloor = sortedHistory[Math.floor(sortedHistory.length * 0.15)]
    dynamicThresholdDb = Math.min(-20, Math.max(-60, noiseFloor + 3))
  }

  function getVolumeDb() {
    analyser.getFloatTimeDomainData(samples)

    let sumOfSquares = 0
    for (const sample of samples) {
      sumOfSquares += sample * sample
    }

    const rootMeanSquare = Math.sqrt(sumOfSquares / samples.length)
    return rootMeanSquare === 0 ? -100 : 20 * Math.log10(rootMeanSquare)
  }

  function getSilencePlaybackRate() {
    const baseRate = normalPlaybackRate ?? video.value?.playbackRate ?? 1
    return Math.min(16, Math.max(3, baseRate * 2))
  }

  function enterSilence() {
    isAccelerating = true

    if (gain) {
      const now = gain.context.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setTargetAtTime(0, now, 0.015)
    }
  }

  function exitSilence() {
    if (normalPlaybackRate !== null) {
      setControlledPlaybackRate(normalPlaybackRate)
    }

    isAccelerating = false
    silenceDuration = 0
    restoreGain()
  }

  function analyse() {
    animationFrame = null

    if (!shouldRun() || !analyser || !samples) {
      stop()
      return
    }

    const now = performance.now()
    const elapsed = lastSampleTime === 0 ? 0 : Math.min(now - lastSampleTime, 100)
    lastSampleTime = now

    const volumeDb = getVolumeDb()
    updateDynamicThreshold(volumeDb)

    if (isSilent) {
      if (volumeDb > dynamicThresholdDb + HYSTERESIS_DB) {
        isSilent = false
      }
    } else if (volumeDb < dynamicThresholdDb) {
      isSilent = true
    }

    if (isSilent) {
      silenceDuration += elapsed

      if (silenceDuration >= SILENCE_HOLD_MS) {
        if (!isAccelerating) {
          enterSilence()
        }

        const progress = Math.min((silenceDuration - SILENCE_HOLD_MS) / SPEED_RAMP_MS, 1)
        const baseRate = normalPlaybackRate ?? video.value.playbackRate
        const silenceRate = getSilencePlaybackRate()
        setControlledPlaybackRate(baseRate + (silenceRate - baseRate) * progress)
      }
    } else if (isAccelerating) {
      exitSilence()
    } else {
      silenceDuration = 0
    }

    animationFrame = requestAnimationFrame(analyse)
  }

  async function setupGraph() {
    if (analyser) {
      return
    }

    const videoElement = video.value
    if (!videoElement) {
      return
    }

    audioContext ??= new AudioContext()
    await audioContext.resume()
    if (audioContext.state !== 'running' || destroyed || video.value !== videoElement) {
      return
    }

    const source = audioContext.createMediaElementSource(videoElement)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = ANALYSER_FFT_SIZE
    analyser.smoothingTimeConstant = 0
    delay = audioContext.createDelay(1)
    gain = audioContext.createGain()

    source.connect(analyser)
    analyser.connect(delay)
    delay.connect(gain)
    gain.connect(audioContext.destination)

    samples = new Float32Array(analyser.fftSize)
  }

  async function start() {
    if (!shouldRun() || animationFrame !== null) {
      return
    }

    normalPlaybackRate ??= video.value.playbackRate

    try {
      graphSetupPromise ??= setupGraph()
      await graphSetupPromise
      if (!analyser) {
        graphSetupPromise = null
        return
      }
      await audioContext?.resume()
    } catch (error) {
      if (!analyser && audioContext?.state !== 'running') {
        graphSetupPromise = null
      }
      console.warn('Unable to analyse audio for silence skipping', error)
      return
    }

    if (!shouldRun() || !analyser || animationFrame !== null) {
      return
    }

    delay.delayTime.value = LOOKAHEAD_SECONDS
    lastSampleTime = 0
    animationFrame = requestAnimationFrame(analyse)
  }

  /**
   * Tracks user-selected rates and identifies rate changes made by this helper.
   * @param {number} rate
   * @returns {boolean} whether the event was caused by silence skipping
   */
  function handlePlaybackRateChange(rate) {
    if (controlledPlaybackRate !== null && Math.abs(rate - controlledPlaybackRate) < 0.01) {
      return true
    }

    controlledPlaybackRate = null
    if (controlledPlaybackRateTimeout !== null) {
      clearTimeout(controlledPlaybackRateTimeout)
      controlledPlaybackRateTimeout = null
    }
    normalPlaybackRate = rate

    if (isAccelerating) {
      isAccelerating = false
      silenceDuration = 0
      restoreGain()
    }

    return false
  }

  /**
   * @param {number | null} fallbackRate
   * @returns {number | null}
   */
  function getNormalPlaybackRate(fallbackRate) {
    return normalPlaybackRate ?? fallbackRate
  }

  function handlePlay() {
    start()
  }

  function handlePause() {
    stop()
  }

  function handleVolumeChange() {
    updateEnabledState()
  }

  function handlePlaybackStateChange() {
    updateEnabledState()
  }

  function updateEnabledState() {
    if (shouldRun()) {
      start()
    } else {
      stop()
    }
  }

  function suspend() {
    suspended = true
    stop()
  }

  function resume() {
    suspended = false
    updateEnabledState()
  }

  watch([enabled, isLive], updateEnabledState)

  onMounted(() => {
    video.value?.addEventListener('play', handlePlay)
    video.value?.addEventListener('pause', handlePause)
    video.value?.addEventListener('volumechange', handleVolumeChange)
    video.value?.addEventListener('playing', handlePlaybackStateChange)
    video.value?.addEventListener('waiting', handlePlaybackStateChange)
    video.value?.addEventListener('seeking', handlePlaybackStateChange)
    video.value?.addEventListener('seeked', handlePlaybackStateChange)
    updateEnabledState()
  })

  onBeforeUnmount(() => {
    destroyed = true
    video.value?.removeEventListener('play', handlePlay)
    video.value?.removeEventListener('pause', handlePause)
    video.value?.removeEventListener('volumechange', handleVolumeChange)
    video.value?.removeEventListener('playing', handlePlaybackStateChange)
    video.value?.removeEventListener('waiting', handlePlaybackStateChange)
    video.value?.removeEventListener('seeking', handlePlaybackStateChange)
    video.value?.removeEventListener('seeked', handlePlaybackStateChange)
    stop()
    if (controlledPlaybackRateTimeout !== null) {
      clearTimeout(controlledPlaybackRateTimeout)
    }
    audioContext?.close()
  })

  return {
    getNormalPlaybackRate,
    handlePlaybackRateChange,
    resume,
    suspend,
  }
}
