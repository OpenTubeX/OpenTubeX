import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import store from '../../../store/index'
import {
  DEFAULT_VIDEO_ZOOM,
  formatVideoZoom,
  getVideoFillZoom,
  getVideoFillZoomProximity,
  resolveVideoZoomPinch,
  sanitizeVideoZoom,
  stepVideoZoom,
  VIDEO_ZOOM_LEVELS,
} from '../../../helpers/player/videoZoom'

/**
 * Zooms into the video, from the zoom menu and shortcuts or with a pinch, and pans the
 * zoomed video with a shift-drag or with the pinch's fingers.
 * @param {{
 *   container: import('vue').Ref<HTMLElement | null>,
 *   isNativeFullscreenActive: () => boolean,
 *   mediaTabId: string,
 *   onPinchStart: () => void,
 *   props: { format: string, shortsPlayer: boolean, videoId: string },
 *   showValueChange: (message: string, icons: string, invertContentOrder?: boolean, seekSeconds?: number, revealControls?: boolean) => void,
 *   useVrMode: import('vue').ComputedRef<boolean>,
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 * }} options
 */
export function useVideoZoom({
  container,
  isNativeFullscreenActive,
  mediaTabId,
  onPinchStart,
  props,
  showValueChange,
  useVrMode,
  video,
}) {
  const enableVideoZoom = computed(() => store.getters.getEnableVideoZoom)
  const selectedVideoZoom = computed(() => {
    return sanitizeVideoZoom(store.getters.getTabVideoZoom(mediaTabId))
  })
  const videoZoomGestureZoom = ref(null)
  const videoFillZoomProximity = ref(0)
  const videoFillZoomSnapReady = ref(false)

  const videoZoomPossible = computed(() => {
    // Audio only playback has no video surface to crop and the shorts player
    // deliberately lets its content overflow the container, which is what
    // keeps a scaled video from spilling over the page for the other layouts.
    return enableVideoZoom.value && props.format !== 'audio' && !props.shortsPlayer && !useVrMode.value
  })

  /** @type {import('vue').ComputedRef<number>} */
  const videoZoom = computed(() => {
    if (!videoZoomPossible.value) {
      return DEFAULT_VIDEO_ZOOM
    }

    return videoZoomGestureZoom.value ?? selectedVideoZoom.value
  })

  /**
   * Which part of the zoomed video is visible, as a fraction of the hidden
   * overflow on each axis (-1 to 1). Kept relative so it survives zoom
   * changes, and per player because the framing only matters for the video
   * that is currently on screen.
   */
  const videoZoomOffset = reactive({ x: 0, y: 0 })

  /** Whether a shift-drag is currently moving the zoomed video. */
  const videoZoomPanning = ref(false)
  const videoZoomPinching = ref(false)

  /** Whether releasing the pointer would start a pan, which the cursor shows. */
  const videoZoomPanReady = ref(false)

  const videoZoomPannable = computed(() => videoZoom.value !== DEFAULT_VIDEO_ZOOM)

  const videoZoomStyle = computed(() => {
    if (!videoZoomPannable.value) {
      return undefined
    }

    // The translation is applied in the video's own coordinate system, which
    // the scale then magnifies, so the offset that reaches the edge of the
    // crop shrinks as the zoom grows.
    const limit = 50 * (videoZoom.value - 1) / videoZoom.value

    return {
      transform: `scale(${videoZoom.value}) translate(${videoZoomOffset.x * limit}%, ${videoZoomOffset.y * limit}%)`
    }
  })

  watch(videoZoomPannable, (pannable) => {
    if (!pannable) {
      recenterVideoZoom()
      videoZoomPanReady.value = false
    }
  })

  // The zoom level belongs to this player (and therefore this tab), while the
  // framing belongs to one specific video. A player reused for the next video
  // keeps its zoom level but starts centered again.
  watch(() => props.videoId, () => {
    invalidateVideoZoomPinch()
    recenterVideoZoom()
    if (selectedVideoZoom.value > VIDEO_ZOOM_LEVELS.at(-1)) updateVideoZoom(VIDEO_ZOOM_LEVELS.at(-1))
  })

  function recenterVideoZoom() {
    videoZoomOffset.x = 0
    videoZoomOffset.y = 0
  }

  /** @param {number} value */
  function updateVideoZoom(value) {
    store.commit('setTabVideoZoom', {
      tabId: mediaTabId,
      value: sanitizeVideoZoom(value)
    })
  }

  /** @param {number} direction `1` to zoom in, `-1` to zoom out */
  function changeVideoZoom(direction) {
    const newZoom = stepVideoZoom(videoZoom.value, direction)

    if (newZoom !== videoZoom.value) {
      updateVideoZoom(newZoom)
    }

    showValueChange(formatVideoZoom(newZoom), 'search')
  }

  /**
   * A pinch can't carry over into or out of fullscreen, and only fullscreen
   * pinches can zoom past the largest level to fill the screen.
   * @param {boolean} fullscreen
   */
  function handleVideoZoomFullscreenChange(fullscreen) {
    if (videoZoomPinchStart && videoZoomPinchStart.fullscreen !== fullscreen) invalidateVideoZoomPinch()
    if (!fullscreen && selectedVideoZoom.value > VIDEO_ZOOM_LEVELS.at(-1)) {
      updateVideoZoom(VIDEO_ZOOM_LEVELS.at(-1))
    }
  }

  // #region video zoom panning

  /** @type {{ pointerId: number, x: number, y: number, offsetX: number, offsetY: number } | null} */
  let videoZoomPanStart = null
  let videoZoomPointerInside = false
  let videoZoomSuppressClick = false
  let videoZoomSuppressClickTimer = null
  const videoZoomTouchPointers = new Map()
  let videoZoomPinchStart = null

  function handleVideoZoomPointerEnter(event) {
    videoZoomPointerInside = true
    videoZoomPanReady.value = videoZoomPannable.value && event.shiftKey
  }

  function handleVideoZoomPointerLeave() {
    videoZoomPointerInside = false

    if (!videoZoomPanStart) {
      videoZoomPanReady.value = false
    }
  }

  function getVideoZoomGestureGeometry() {
    const videoElement = video.value
    if (!videoElement) return null

    const bounds = videoElement.getBoundingClientRect()
    const transform = getComputedStyle(videoElement).transform
    const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform)
    const scale = Math.hypot(matrix.a, matrix.b)
    if (bounds.width <= 0 || bounds.height <= 0 || scale <= 0) return null
    const size = {
      width: bounds.width / scale,
      height: bounds.height / scale,
    }
    const maximumTranslation = {
      x: size.width * (scale - 1) / 2,
      y: size.height * (scale - 1) / 2,
    }

    return {
      zoom: scale,
      center: {
        x: bounds.left + bounds.width / 2 - matrix.e,
        y: bounds.top + bounds.height / 2 - matrix.f,
      },
      offset: {
        x: maximumTranslation.x > 0
          ? clampVideoZoomOffset(matrix.e / maximumTranslation.x)
          : 0,
        y: maximumTranslation.y > 0
          ? clampVideoZoomOffset(matrix.f / maximumTranslation.y)
          : 0,
      },
      size,
    }
  }

  /** @param {KeyboardEvent} event */
  function handleVideoZoomModifierKey(event) {
    videoZoomPanReady.value = videoZoomPointerInside && videoZoomPannable.value && event.shiftKey
  }

  /**
   * Pinch gestures may begin on non-interactive descendants of Shaka's
   * surface, including the SVG inside its central play button. Menus and the
   * bottom control panel retain their own two-finger interactions.
   * @param {EventTarget | null} target
   * @returns {boolean}
   */
  function isVideoZoomGestureTarget(target) {
    if (target === video.value) return true
    if (!(target instanceof Element)) return false

    return target.closest('.shaka-controls-container') !== null &&
      target.closest([
        '.shaka-controls-button-panel',
        '.shaka-seek-bar-container',
        '.shaka-settings-menu',
        '.shaka-context-menu',
      ].join(',')) === null
  }

  /**
   * Starts a pinch once a second finger touches the video, or a pan for a shift-drag.
   * @param {PointerEvent} event
   */
  function startVideoZoomGesture(event) {
    if (
      event.pointerType === 'touch' &&
      videoZoomPossible.value &&
      isVideoZoomGestureTarget(event.target)
    ) {
      videoZoomTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (videoZoomTouchPointers.size === 2) {
        const points = [...videoZoomTouchPointers.values()]
        const geometry = getVideoZoomGestureGeometry()
        if (geometry) {
          onPinchStart()
          const fullscreen = isNativeFullscreenActive()
          videoZoomGestureZoom.value = geometry.zoom
          videoZoomOffset.x = geometry.offset.x
          videoZoomOffset.y = geometry.offset.y
          const focal = {
            x: (points[0].x + points[1].x) / 2 - geometry.center.x,
            y: (points[0].y + points[1].y) / 2 - geometry.center.y,
          }
          videoZoomPinchStart = {
            distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)),
            zoom: geometry.zoom,
            offset: geometry.offset,
            focal,
            currentFocal: focal,
            center: geometry.center,
            size: geometry.size,
            videoId: props.videoId,
            fullscreen,
            fillZoom: fullscreen
              ? getVideoFillZoom(
                  { width: container.value.clientWidth, height: container.value.clientHeight },
                  geometry.size,
                  { width: video.value.videoWidth, height: video.value.videoHeight },
                )
              : null,
          }
          videoFillZoomProximity.value = 0
          videoFillZoomSnapReady.value = false
          videoZoomPinching.value = true
          videoZoomSuppressClick = true
          for (const pointerId of videoZoomTouchPointers.keys()) {
            container.value?.setPointerCapture(pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
    }

    if (!videoZoomPannable.value || !event.shiftKey || event.button !== 0) {
      return
    }

    // shaka-player's controls cover the video, so the drag is claimed in the
    // capture phase before they can turn it into a play/pause click.
    event.preventDefault()
    event.stopPropagation()

    videoZoomPanStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: videoZoomOffset.x,
      offsetY: videoZoomOffset.y,
    }
    videoZoomPanning.value = true
    // Chromium still fires the click that follows a prevented pointerdown.
    videoZoomSuppressClick = true
    container.value?.setPointerCapture(event.pointerId)
  }

  /**
   * @param {PointerEvent} event
   * @returns {boolean} whether the event belongs to a pinch
   */
  function moveVideoZoomPinch(event) {
    if (videoZoomTouchPointers.has(event.pointerId)) {
      videoZoomTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    if (videoZoomPinchStart?.invalidated) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }

    if (videoZoomPinchStart && videoZoomTouchPointers.size >= 2) {
      const points = [...videoZoomTouchPointers.values()]
      const focal = {
        x: (points[0].x + points[1].x) / 2 - videoZoomPinchStart.center.x,
        y: (points[0].y + points[1].y) / 2 - videoZoomPinchStart.center.y,
      }
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const resolved = resolveVideoZoomPinch({
        startZoom: videoZoomPinchStart.zoom,
        startOffset: videoZoomPinchStart.offset,
        startFocal: videoZoomPinchStart.focal,
        focal,
        scale: distance / videoZoomPinchStart.distance,
        size: videoZoomPinchStart.size,
        maximumZoom: Math.max(VIDEO_ZOOM_LEVELS.at(-1), videoZoomPinchStart.fillZoom ?? 0),
      })
      videoZoomGestureZoom.value = resolved.zoom
      videoZoomOffset.x = resolved.offset.x
      videoZoomOffset.y = resolved.offset.y
      videoZoomPinchStart.currentFocal = focal
      const movingTowardFill = videoZoomPinchStart.fillZoom !== null &&
        Math.abs(resolved.zoom - videoZoomPinchStart.zoom) >= 0.01 &&
        Math.abs(resolved.zoom - videoZoomPinchStart.fillZoom) <
          Math.abs(videoZoomPinchStart.zoom - videoZoomPinchStart.fillZoom)
      const fill = getVideoFillZoomProximity(resolved.zoom, videoZoomPinchStart.fillZoom)
      videoFillZoomProximity.value = movingTowardFill ? fill.proximity : 0
      videoFillZoomSnapReady.value = movingTowardFill && fill.snap
      event.preventDefault()
      event.stopPropagation()
      return true
    }

    return false
  }

  /** @param {PointerEvent} event */
  function moveVideoZoomPan(event) {
    if (!videoZoomPanStart) {
      videoZoomPanReady.value = videoZoomPointerInside && videoZoomPannable.value && event.shiftKey
      return
    }

    if (event.pointerId !== videoZoomPanStart.pointerId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const videoElement = video.value
    if (!videoElement) {
      return
    }

    // `offsetWidth`/`offsetHeight` are the layout size, which the zoom
    // transform does not change, so this is the overflow the crop hides.
    const maxX = videoElement.offsetWidth * (videoZoom.value - 1) / 2
    const maxY = videoElement.offsetHeight * (videoZoom.value - 1) / 2

    if (maxX > 0) {
      videoZoomOffset.x = clampVideoZoomOffset(
        videoZoomPanStart.offsetX + (event.clientX - videoZoomPanStart.x) / maxX
      )
    }

    if (maxY > 0) {
      videoZoomOffset.y = clampVideoZoomOffset(
        videoZoomPanStart.offsetY + (event.clientY - videoZoomPanStart.y) / maxY
      )
    }
  }

  /** @param {PointerEvent} event */
  function cancelVideoZoomPan(event) {
    if (!endVideoZoomPan(event)) {
      return
    }

    // A cancelled gesture never produces the click that clears this itself,
    // so it would otherwise swallow the next unrelated click on the player.
    videoZoomSuppressClick = false
  }

  function invalidateVideoZoomPinch() {
    if (!videoZoomPinchStart || videoZoomPinchStart.invalidated) return
    videoZoomPinchStart.invalidated = true
    videoZoomOffset.x = videoZoomPinchStart.offset.x
    videoZoomOffset.y = videoZoomPinchStart.offset.y
    videoZoomGestureZoom.value = null
    videoZoomPinching.value = false
    videoFillZoomProximity.value = 0
    videoFillZoomSnapReady.value = false
  }

  function endVideoZoomPinchPointer(event, cancelled = false) {
    if (!videoZoomTouchPointers.has(event.pointerId)) return false

    videoZoomTouchPointers.delete(event.pointerId)
    if (!videoZoomPinchStart) return false

    event.preventDefault()
    event.stopPropagation()
    if (container.value?.hasPointerCapture(event.pointerId)) {
      container.value.releasePointerCapture(event.pointerId)
    }

    const stale = videoZoomPinchStart.invalidated ||
      videoZoomPinchStart.videoId !== props.videoId ||
      videoZoomPinchStart.fullscreen !== isNativeFullscreenActive()
    if (stale) invalidateVideoZoomPinch()
    const gestureZoom = videoZoomGestureZoom.value ?? videoZoomPinchStart.zoom
    const fillZoom = videoZoomPinchStart.fillZoom
    const finalZoom = !cancelled && videoFillZoomSnapReady.value && fillZoom !== null
      ? fillZoom
      : gestureZoom
    if (!stale) {
      if (finalZoom === fillZoom && !cancelled) recenterVideoZoom()
      updateVideoZoom(finalZoom)
      if (!cancelled) showValueChange(formatVideoZoom(finalZoom), 'search', false, 0, false)
    }
    videoZoomGestureZoom.value = null
    videoZoomPinchStart = null
    videoZoomPinching.value = false
    videoFillZoomProximity.value = 0
    videoFillZoomSnapReady.value = false
    videoZoomTouchPointers.clear()
    clearTimeout(videoZoomSuppressClickTimer)
    videoZoomSuppressClickTimer = setTimeout(() => {
      videoZoomSuppressClick = false
      videoZoomSuppressClickTimer = null
    }, 0)
    return true
  }

  /**
   * @param {PointerEvent} event
   * @returns {boolean} whether the event ended this player's pan
   */
  function endVideoZoomPan(event) {
    if (!videoZoomPanStart || event.pointerId !== videoZoomPanStart.pointerId) {
      return false
    }

    // A cancelled pointer has already lost the capture.
    if (container.value?.hasPointerCapture(event.pointerId)) {
      container.value.releasePointerCapture(event.pointerId)
    }

    videoZoomPanStart = null
    videoZoomPanning.value = false
    videoZoomPanReady.value = videoZoomPointerInside && videoZoomPannable.value && event.shiftKey

    return true
  }

  /**
   * Swallows the click that a finished pan would otherwise leave behind.
   * @param {MouseEvent} event
   */
  function suppressVideoZoomClick(event) {
    if (!videoZoomSuppressClick) {
      return
    }

    videoZoomSuppressClick = false
    clearTimeout(videoZoomSuppressClickTimer)
    videoZoomSuppressClickTimer = null
    event.preventDefault()
    event.stopPropagation()
  }

  /**
   * @param {number} value
   * @returns {number}
   */
  function clampVideoZoomOffset(value) {
    return Math.min(Math.max(value, -1), 1)
  }

  // #endregion video zoom panning

  onBeforeUnmount(() => {
    videoZoomTouchPointers.clear()
    videoZoomPinchStart = null
    videoZoomGestureZoom.value = null
    videoFillZoomProximity.value = 0
    videoFillZoomSnapReady.value = false
    clearTimeout(videoZoomSuppressClickTimer)
  })

  return {
    cancelVideoZoomPan,
    changeVideoZoom,
    endVideoZoomPan,
    endVideoZoomPinchPointer,
    handleVideoZoomFullscreenChange,
    handleVideoZoomModifierKey,
    handleVideoZoomPointerEnter,
    handleVideoZoomPointerLeave,
    moveVideoZoomPan,
    moveVideoZoomPinch,
    startVideoZoomGesture,
    suppressVideoZoomClick,
    updateVideoZoom,
    videoFillZoomProximity,
    videoFillZoomSnapReady,
    videoZoom,
    videoZoomGestureZoom,
    videoZoomPanReady,
    videoZoomPanning,
    videoZoomPinching,
    videoZoomPossible,
    videoZoomStyle,
  }
}
