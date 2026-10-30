import { onBeforeUnmount } from 'vue'

/** @typedef {'voiceOver' | 'boost'} PlayerAudioGainStage */

/**
 * Routes the player's audio through gain stages that multiply with the
 * element volume, optionally downmixed to mono. The graph is only built once
 * a stage leaves unity gain or mono is enabled, because a media element can
 * never be detached from Web Audio again.
 *
 * A media element can only have one MediaElementAudioSourceNode, so all output
 * processing for the player must share this graph.
 *
 * @param {import('vue').Ref<HTMLVideoElement | null>} video
 */
export function usePlayerAudioOutput(video) {
  /** @type {Record<PlayerAudioGainStage, number>} */
  const gains = { voiceOver: 1, boost: 1 }
  let mono = false

  /** @type {AudioContext | null} */
  let audioContext = null
  /** @type {Record<PlayerAudioGainStage, GainNode> | null} */
  let gainNodes = null
  /** @type {GainNode | null} */
  let monoNode = null
  /** @type {Promise<void> | null} */
  let setupPromise = null
  /** @type {HTMLVideoElement | null} */
  let routedVideo = null
  let destroyed = false

  // The element only plays through the graph, so an interruption that suspends
  // the context, such as a phone call on Android, would otherwise leave it silent.
  function resumeWhilePlaying() {
    if (audioContext?.state === 'suspended' && routedVideo?.paused === false) {
      audioContext.resume().catch(error => console.warn('Unable to resume player audio output', error))
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
    const voiceOver = audioContext.createGain()
    const boost = audioContext.createGain()
    voiceOver.gain.value = gains.voiceOver
    boost.gain.value = gains.boost
    monoNode = audioContext.createGain()
    monoNode.channelCount = 1
    applyMono()
    source.connect(voiceOver).connect(boost).connect(monoNode).connect(audioContext.destination)
    gainNodes = { voiceOver, boost }
    routedVideo = videoElement
    audioContext.addEventListener('statechange', resumeWhilePlaying)
    videoElement.addEventListener('playing', resumeWhilePlaying)
  }

  async function ensureGraph() {
    try {
      setupPromise ??= setupGraph()
      await setupPromise
    } catch (error) {
      console.warn('Unable to adjust player audio output', error)
    } finally {
      if (!gainNodes) {
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

    if (!gainNodes && value !== 1) {
      await ensureGraph()
    }

    if (!gainNodes) {
      return
    }

    const gain = gainNodes[stage].gain
    const now = audioContext.currentTime
    gain.cancelScheduledValues(now)
    gain.setTargetAtTime(gains[stage], now, 0.015)
  }

  /**
   * @param {boolean} enabled
   */
  async function setMono(enabled) {
    mono = enabled

    if (!gainNodes && enabled) {
      await ensureGraph()
    }

    if (gainNodes) {
      applyMono()
    }
  }

  onBeforeUnmount(() => {
    destroyed = true
    audioContext?.removeEventListener('statechange', resumeWhilePlaying)
    routedVideo?.removeEventListener('playing', resumeWhilePlaying)
    routedVideo = null
    audioContext?.close().catch(() => {})
    audioContext = null
    gainNodes = null
    monoNode = null
    setupPromise = null
  })

  return { setGain, setMono }
}
