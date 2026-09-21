/** Supplies native frames to the existing WebGL VR renderer and frame callbacks. */
export function attachAndroidVideoFrames(element, canvas, { captureFrame, canCapture, onError, getFieldOfView = () => 75 }) {
  const callbacks = new Map()
  const originalRequest = Object.getOwnPropertyDescriptor(element, 'requestVideoFrameCallback')
  const originalCancel = Object.getOwnPropertyDescriptor(element, 'cancelVideoFrameCallback')
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
  const originalTexture = gl && Object.getOwnPropertyDescriptor(gl, 'texImage2D')
  const uploadTexture = gl?.texImage2D
  let image = null
  let sequence = 0
  let animation = null
  let busy = false
  let destroyed = false
  let lastTime = -1
  let lastFrameAt = -Infinity
  let presentedFrames = 0
  let generation = 0

  if (gl) {
    gl.texImage2D = function (...args) {
      if (args.at(-1) === element) {
        if (!image) return
        args[args.length - 1] = image
      }
      return uploadTexture.apply(this, args)
    }
  }

  function schedule() {
    if (!destroyed && !busy && callbacks.size && animation === null) animation = requestAnimationFrame(tick)
  }
  function reset() { image = null; lastTime = -1; generation++ }

  async function tick(now) {
    animation = null
    if (destroyed || !callbacks.size || document.hidden || !canCapture()) return
    const time = element.currentTime
    if (time === lastTime) return
    if (now - lastFrameAt < 1000 / 30) { schedule(); return }
    busy = true
    const capturedGeneration = generation
    try {
      // A panorama covers more than the visible viewport. Account for zoom so
      // downscaling does not turn a small field of view into a blurry texture.
      // The drawing buffer includes device pixel ratio and UI scale; also stay
      // within the native capture API's 16-megapixel allocation limit.
      const fieldOfView = getFieldOfView()
      const panoramaScale = Number.isFinite(fieldOfView) && fieldOfView > 0 ? 360 / fieldOfView : Infinity
      const scale = Math.min(1, Math.sqrt(16777216 / (element.videoWidth * element.videoHeight)), panoramaScale * Math.max(
        (canvas?.width || element.videoWidth) / element.videoWidth,
        (canvas?.height || element.videoHeight) / element.videoHeight))
      const { dataUrl } = await captureFrame({
        width: Math.max(1, Math.floor(element.videoWidth * scale)),
        height: Math.max(1, Math.floor(element.videoHeight * scale)),
        format: 'jpeg',
      })
      const nextImage = new Image()
      nextImage.src = dataUrl
      await nextImage.decode()
      if (destroyed || capturedGeneration !== generation || document.hidden || !canCapture()) return
      image = nextImage
      lastTime = time
      lastFrameAt = now
      presentedFrames++
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const callback of pending) {
        callback(performance.now(), {
          mediaTime: time,
          presentedFrames,
          width: element.videoWidth,
          height: element.videoHeight,
          presentationTime: now,
          expectedDisplayTime: performance.now(),
          processingDuration: 0,
        })
      }
    } catch (error) {
      if (!destroyed && canCapture()) onError(error)
    } finally {
      busy = false
      if (!element.paused) schedule()
    }
  }

  Object.defineProperty(element, 'requestVideoFrameCallback', {
    configurable: true,
    value: callback => {
      const id = ++sequence
      callbacks.set(id, callback)
      schedule()
      return id
    }
  })
  Object.defineProperty(element, 'cancelVideoFrameCallback', { configurable: true, value: id => callbacks.delete(id) })
  for (const event of ['playing', 'seeked', 'timeupdate']) element.addEventListener(event, schedule)
  element.addEventListener('emptied', reset)
  document.addEventListener('visibilitychange', schedule)
  document.addEventListener('fullscreenchange', schedule)

  return () => {
    if (destroyed) return
    destroyed = true
    callbacks.clear()
    image = null
    if (animation !== null) cancelAnimationFrame(animation)
    for (const event of ['playing', 'seeked', 'timeupdate']) element.removeEventListener(event, schedule)
    element.removeEventListener('emptied', reset)
    document.removeEventListener('visibilitychange', schedule)
    document.removeEventListener('fullscreenchange', schedule)
    for (const [name, descriptor] of [['requestVideoFrameCallback', originalRequest], ['cancelVideoFrameCallback', originalCancel]]) {
      if (descriptor) Object.defineProperty(element, name, descriptor)
      else delete element[name]
    }
    if (gl) {
      if (originalTexture) Object.defineProperty(gl, 'texImage2D', originalTexture)
      else delete gl.texImage2D
    }
  }
}
