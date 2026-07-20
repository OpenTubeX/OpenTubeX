import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const AMBIENT_FRAME_INTERVAL_MS = 100
const AMBIENT_FRAME_BLEND_ALPHA = 0.14
const AMBIENT_FRAME_SETTLE_TICKS = 16
const AMBIENT_FRAME_WIDTH = 80
const AMBIENT_FRAME_HEIGHT = 45

/**
 * Renders low-resolution video frames for the ambient glow behind the player.
 * @param {object} options
 * @param {import('vue').ComputedRef<boolean>} options.enabled
 * @param {import('vue').Ref<HTMLVideoElement | null>} options.video
 */
export function useAmbientMode({ enabled, video }) {
  /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
  const ambientCanvas = ref(null)
  /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
  const ambientLayoutCanvas = ref(null)
  /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
  const ambientFullscreenCanvas = ref(null)

  /** @type {number|null} */
  let frameInterval = null
  let lastVideoTime = -1
  let blendTicksRemaining = 0
  let hasAmbientFrame = false
  let hasLoggedRenderError = false

  function drawAmbientFrame() {
    const canvas = ambientCanvas.value
    const videoElement = video.value

    const videoTimeChanged = videoElement?.currentTime !== lastVideoTime

    if (!enabled.value || document.hidden || !canvas || !videoElement ||
      videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      (!videoTimeChanged && blendTicksRemaining === 0)) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    if (videoTimeChanged) {
      blendTicksRemaining = AMBIENT_FRAME_SETTLE_TICKS
    }

    const wasInitialized = hasAmbientFrame
    context.globalAlpha = wasInitialized ? AMBIENT_FRAME_BLEND_ALPHA : 1

    try {
      context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
      hasAmbientFrame = true
      lastVideoTime = videoElement.currentTime
      blendTicksRemaining = wasInitialized ? Math.max(0, blendTicksRemaining - 1) : 0

      for (const mirrorCanvas of [ambientLayoutCanvas.value, ambientFullscreenCanvas.value]) {
        const mirrorContext = mirrorCanvas?.getContext('2d')
        if (mirrorCanvas && mirrorContext) {
          mirrorContext.clearRect(0, 0, mirrorCanvas.width, mirrorCanvas.height)
          mirrorContext.drawImage(canvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height)
        }
      }
    } catch (error) {
      if (!hasLoggedRenderError) {
        console.warn('Unable to render ambient mode frame', error)
        hasLoggedRenderError = true
      }
    } finally {
      context.globalAlpha = 1
    }
  }

  function startAmbientFrames() {
    if (frameInterval !== null) {
      return
    }

    lastVideoTime = -1
    blendTicksRemaining = 0
    hasAmbientFrame = false
    drawAmbientFrame()
    frameInterval = window.setInterval(drawAmbientFrame, AMBIENT_FRAME_INTERVAL_MS)
  }

  function stopAmbientFrames() {
    if (frameInterval !== null) {
      window.clearInterval(frameInterval)
      frameInterval = null
    }
  }

  watch(enabled, (isEnabled) => {
    if (isEnabled) {
      startAmbientFrames()
    } else {
      stopAmbientFrames()
    }
  })

  onMounted(() => {
    const canvas = ambientCanvas.value
    if (!canvas) {
      return
    }

    canvas.width = AMBIENT_FRAME_WIDTH
    canvas.height = AMBIENT_FRAME_HEIGHT

    for (const mirrorCanvas of [ambientLayoutCanvas.value, ambientFullscreenCanvas.value]) {
      if (mirrorCanvas) {
        mirrorCanvas.width = AMBIENT_FRAME_WIDTH
        mirrorCanvas.height = AMBIENT_FRAME_HEIGHT
      }
    }

    if (enabled.value) {
      startAmbientFrames()
    }
  })

  onBeforeUnmount(stopAmbientFrames)

  return {
    ambientCanvas,
    ambientFullscreenCanvas,
    ambientLayoutCanvas,
  }
}
