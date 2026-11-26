import { onBeforeUnmount } from 'vue'

/** @typedef {'voiceOver' | 'boost' | 'loudness'} PlayerAudioGainStage */

// These stages only turn the audio down, so they scale the element volume.
/** @type {readonly PlayerAudioGainStage[]} */
const ATTENUATION_STAGES = ['voiceOver', 'loudness']

/** @type {PropertyDescriptor | undefined} */
let nativeVolume

/**
 * Applies the player's output gains, which multiply with the volume the user
 * chose, and optionally downmixes it to mono.
 *
 * Gains below unity scale the element volume, so the audio keeps Chromium's
 * playback path. Web Audio output adds tens of milliseconds of latency, and on
 * Bluetooth well over 100 ms, without delaying the video to match. Only volume
 * boost and mono need Web Audio, so the graph is built once one of them is
 * used, because a media element can never be detached from Web Audio again.
 * The graph processes the audio after the element volume.
 *
 * A media element can only have one MediaElementAudioSourceNode, so all output
 * processing for the player must share this graph.
 *
 * @param {import('vue').Ref<HTMLVideoElement | null>} video
 */
export function usePlayerAudioOutput(video) {
  /** @type {Record<PlayerAudioGainStage, number>} */
  const gains = { voiceOver: 1, boost: 1, loudness: 1 }
  let mono = false

  /** @type {HTMLVideoElement | null} */
  let volumeElement = null
  let userVolume = 1
  /** @type {((event: Event) => void) | null} */
  let suppressAttenuationEvents = null

  /** @type {AudioContext | null} */
  let audioContext = null
  /** @type {GainNode | null} */
  let boostNode = null
  /** @type {GainNode | null} */
  let monoNode = null
  /** @type {Promise<void> | null} */
  let setupPromise = null
  /** @type {HTMLVideoElement | null} */
  let routedVideo = null
  let destroyed = false

  function attenuation() {
    return ATTENUATION_STAGES.reduce((product, stage) => product * Math.min(1, Math.max(0, gains[stage])), 1)
  }

  function applyElementVolume() {
    if (volumeElement) {
      nativeVolume.set.call(volumeElement, userVolume * attenuation())
    }
  }

  /**
   * Makes `volume` report and set the user's volume, so the controls, saved
   * volumes and other features never see the attenuation. Call it before the
   * player sets its initial volume.
   *
   * @param {HTMLVideoElement} videoElement
   */
  function attach(videoElement) {
    if (volumeElement) {
      return
    }

    nativeVolume ??= Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
    volumeElement = videoElement
    userVolume = nativeVolume.get.call(videoElement)
    Object.defineProperty(videoElement, 'volume', {
      configurable: true,
      enumerable: true,
      get: () => userVolume,
      set: (value) => {
        const volume = Number(value)
        if (!Number.isFinite(volume)) {
          throw new TypeError(`The provided double value is non-finite: ${value}`)
        }
        if (volume < 0 || volume > 1) {
          throw new DOMException(`The volume provided (${volume}) is outside the range [0, 1].`, 'IndexSizeError')
        }
        const previousVolume = userVolume
        const previousElementVolume = nativeVolume.get.call(videoElement)
        userVolume = volume
        applyElementVolume()
        // While a gain mutes the element, its volume stays 0 and fires no event.
        if (volume !== previousVolume && nativeVolume.get.call(videoElement) === previousElementVolume) {
          setTimeout(() => videoElement.dispatchEvent(new Event('volumechange')))
        }
      }
    })

    // A gain change also fires volumechange. Listeners on the element would
    // take that for the user changing the volume, and save it for the channel.
    let reported = { volume: userVolume, muted: videoElement.muted }
    suppressAttenuationEvents = (event) => {
      if (userVolume === reported.volume && videoElement.muted === reported.muted) {
        event.stopImmediatePropagation()
      } else {
        reported = { volume: userVolume, muted: videoElement.muted }
      }
    }
    // Capturing listeners on the target run before the others.
    videoElement.addEventListener('volumechange', suppressAttenuationEvents, { capture: true })
    applyElementVolume()
  }

  // The element is removed with the player, so its volume is not restored.
  // Doing so would fire volumechange at listeners that may still run.
  function detachVolume() {
    if (!volumeElement) {
      return
    }
    delete volumeElement.volume
    volumeElement.removeEventListener('volumechange', suppressAttenuationEvents, { capture: true })
    volumeElement = null
    suppressAttenuationEvents = null
  }

  // The element only plays through the graph, so an interruption that suspends
  // the context, such as a phone call on Android, would otherwise leave it silent.
  function resumeWhilePlaying() {
    if (audioContext?.state === 'suspended' && routedVideo?.paused === false) {
      audioContext.resume().catch(error => console.warn('Unable to resume player audio output', error))
    }
  }

  // A running context keeps rendering silence after the video pauses, which
  // keeps an audio thread and the device's audio output busy. A resume that
  // finishes after the pause also lands here through 'statechange'.
  function suspendWhilePaused() {
    if (audioContext?.state === 'running' && routedVideo?.paused) {
      audioContext.suspend().catch(error => console.warn('Unable to suspend player audio output', error))
    }
  }

  async function setupGraph() {
    const videoElement = video.value
    if (!videoElement) {
      return
    }

    audioContext ??= new AudioContext()
    await audioContext.resume()
    if (destroyed || video.value !== videoElement) {
      return
    }

    const source = audioContext.createMediaElementSource(videoElement)
    const boost = audioContext.createGain()
    boost.gain.value = gains.boost
    monoNode = audioContext.createGain()
    monoNode.channelCount = 1
    applyMono()
    source.connect(boost).connect(monoNode).connect(audioContext.destination)
    boostNode = boost
    routedVideo = videoElement
    audioContext.addEventListener('statechange', resumeWhilePlaying)
    audioContext.addEventListener('statechange', suspendWhilePaused)
    videoElement.addEventListener('play', resumeWhilePlaying)
    videoElement.addEventListener('playing', resumeWhilePlaying)
    videoElement.addEventListener('pause', suspendWhilePaused)
    suspendWhilePaused()
  }

  async function ensureGraph() {
    try {
      setupPromise ??= setupGraph()
      await setupPromise
    } catch (error) {
      console.warn('Unable to adjust player audio output', error)
    } finally {
      if (!boostNode) {
        setupPromise = null
      }
    }
  }

  // With an explicit single channel, the node downmixes every input channel,
  // and the destination plays that one channel in both ears.
  function applyMono() {
    monoNode.channelCountMode = mono ? 'explicit' : 'max'
  }

  /**
   * @param {PlayerAudioGainStage} stage
   * @param {number} value
   */
  async function setGain(stage, value) {
    gains[stage] = value

    if (ATTENUATION_STAGES.includes(stage)) {
      applyElementVolume()
      return
    }

    if (!boostNode && value !== 1) {
      await ensureGraph()
    }

    if (!boostNode) {
      return
    }

    const gain = boostNode.gain
    const now = audioContext.currentTime
    gain.cancelScheduledValues(now)
    gain.setTargetAtTime(gains.boost, now, 0.015)
  }

  /**
   * @param {boolean} enabled
   */
  async function setMono(enabled) {
    mono = enabled

    if (!boostNode && enabled) {
      await ensureGraph()
    }

    if (boostNode) {
      applyMono()
    }
  }

  onBeforeUnmount(() => {
    destroyed = true
    detachVolume()
    audioContext?.removeEventListener('statechange', resumeWhilePlaying)
    audioContext?.removeEventListener('statechange', suspendWhilePaused)
    routedVideo?.removeEventListener('play', resumeWhilePlaying)
    routedVideo?.removeEventListener('playing', resumeWhilePlaying)
    routedVideo?.removeEventListener('pause', suspendWhilePaused)
    routedVideo = null
    audioContext?.close().catch(() => {})
    audioContext = null
    boostNode = null
    monoNode = null
    setupPromise = null
  })

  return { attach, setGain, setMono }
}
