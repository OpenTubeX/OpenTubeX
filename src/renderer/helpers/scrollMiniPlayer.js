export const DEFAULT_WIDTH = 360
export const DEFAULT_HEIGHT = 202
export const MIN_WIDTH = 240
export const MIN_HEIGHT = 135
export const MAX_WIDTH = 560
export const MAX_HEIGHT = 315
export const MARGIN = 16
export const EDGE_SNAP = 72
export const BOUNCE_MS = 450

export const ENTER_MINI_RATIO = 0.15
export const EXIT_MINI_RATIO = 0.35

/** Minimum inline layout height before scroll mini player may activate. */
export const SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT = 135

/**
 * Expected 16:9 inline player height from container width.
 * @param {HTMLElement | null | undefined} container
 * @param {number} [lastKnownHeight]
 * @returns {number}
 */
export function getScrollMiniInlineLayoutHeight(container, lastKnownHeight = 0) {
  if (!container) {
    return 0
  }

  const width = container.offsetWidth
  if (width <= 0) {
    return 0
  }

  const expectedHeight = Math.round(width * 9 / 16)
  const measuredHeight = container.offsetHeight

  return Math.max(measuredHeight, expectedHeight, lastKnownHeight)
}

/** @typedef {{ left: number, top: number, width: number, height: number, dock: 'left' | 'right' }} ScrollMiniPlayerRect */

/** @type {ScrollMiniPlayerRect | null} */
let savedScrollMiniPlayerRect = null

/**
 * @returns {ScrollMiniPlayerRect | null}
 */
export function getSavedScrollMiniPlayerRect() {
  return savedScrollMiniPlayerRect ? { ...savedScrollMiniPlayerRect } : null
}

/**
 * @param {ScrollMiniPlayerRect | null} rect
 */
export function setSavedScrollMiniPlayerRect(rect) {
  savedScrollMiniPlayerRect = rect ? { ...rect } : null
}

/**
 * @param {string} value
 * @returns {ScrollMiniPlayerRect | null}
 */
export function parseScrollMiniPlayerSavedRect(value) {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value)

    if (
      parsed == null ||
      typeof parsed.left !== 'number' ||
      typeof parsed.top !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return null
    }

    return clampScrollMiniPlayerRect({
      left: parsed.left,
      top: parsed.top,
      width: parsed.width,
      height: parsed.height,
      dock: parsed.dock === 'left' ? 'left' : 'right',
    })
  } catch {
    return null
  }
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @returns {string}
 */
export function serializeScrollMiniPlayerSavedRect(rect) {
  return JSON.stringify({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    dock: rect.dock,
  })
}

/**
 * @returns {{ top: number, left: number, right: number, bottom: number }}
 */
export function getViewportInsets() {
  let topInset = MARGIN

  const topNav = document.querySelector('.topNav')
  const tabBar = document.querySelector('.tabBar')

  if (topNav) {
    const rect = topNav.getBoundingClientRect()
    topInset = Math.max(topInset, rect.bottom + MARGIN)
  } else if (tabBar) {
    const rect = tabBar.getBoundingClientRect()
    topInset = Math.max(topInset, rect.bottom + MARGIN)
  }

  return {
    top: topInset,
    left: MARGIN,
    right: MARGIN,
    bottom: MARGIN,
  }
}

/**
 * @returns {ScrollMiniPlayerRect}
 */
export function getDefaultScrollMiniPlayerRect() {
  const insets = getViewportInsets()
  const width = DEFAULT_WIDTH
  const height = DEFAULT_HEIGHT

  return {
    left: window.innerWidth - width - insets.right,
    top: window.innerHeight - height - insets.bottom,
    width,
    height,
    dock: 'right',
  }
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @returns {ScrollMiniPlayerRect}
 */
export function clampScrollMiniPlayerRect(rect) {
  const insets = getViewportInsets()
  const maxWidth = Math.min(MAX_WIDTH, window.innerWidth - insets.left - insets.right)
  const maxHeight = Math.min(MAX_HEIGHT, window.innerHeight - insets.top - insets.bottom)

  let width = Math.min(Math.max(rect.width, MIN_WIDTH), maxWidth)
  let height = Math.round(width * 9 / 16)
  if (height > maxHeight) {
    height = maxHeight
    width = Math.round(height * 16 / 9)
  }
  if (height < MIN_HEIGHT) {
    height = MIN_HEIGHT
    width = Math.round(height * 16 / 9)
  }

  const maxLeft = window.innerWidth - insets.right - width
  const maxTop = window.innerHeight - insets.bottom - height
  const left = Math.min(Math.max(rect.left, insets.left), maxLeft)
  const top = Math.min(Math.max(rect.top, insets.top), maxTop)
  const dock = getDockFromRect({ left, width }, insets)

  return { left, top, width, height, dock }
}

/**
 * @param {Pick<ScrollMiniPlayerRect, 'left' | 'width'>} rect
 * @param {{ left: number, right: number }} insets
 * @returns {'left' | 'right'}
 */
export function getDockFromRect(rect, insets) {
  const leftDist = rect.left - insets.left
  const rightDist = window.innerWidth - insets.right - (rect.left + rect.width)
  return leftDist <= rightDist ? 'left' : 'right'
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @returns {Record<string, string>}
 */
export function scrollMiniPlayerRectToStyle(rect) {
  return {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: '150',
  }
}

/**
 * @param {HTMLElement | null} element
 * @returns {number}
 */
export function getAnchorVisibleRatio(element) {
  if (!element) {
    return 1
  }

  const rect = element.getBoundingClientRect()
  const visibleTop = Math.max(rect.top, 0)
  const visibleBottom = Math.min(rect.bottom, window.innerHeight)
  const visibleLeft = Math.max(rect.left, 0)
  const visibleRight = Math.min(rect.right, window.innerWidth)

  const visibleWidth = Math.max(0, visibleRight - visibleLeft)
  const visibleHeight = Math.max(0, visibleBottom - visibleTop)
  const visibleArea = visibleWidth * visibleHeight
  const totalArea = rect.width * rect.height

  if (totalArea <= 0) {
    // Zero-height anchors cannot be observed reliably; treat as fully visible
    // so a broken placeholder does not trap the player in mini mode forever.
    return 1
  }

  return visibleArea / totalArea
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ left: number, right: number }} insets
 * @returns {boolean}
 */
export function shouldBounceScrollMiniPlayerToEdge(rect, insets) {
  const leftEdge = insets.left
  const rightEdge = window.innerWidth - insets.right - rect.width
  const nearLeft = rect.left - leftEdge <= EDGE_SNAP
  const nearRight = rightEdge - rect.left <= EDGE_SNAP
  return !nearLeft && !nearRight
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ left: number, right: number, top: number, bottom: number }} insets
 * @returns {ScrollMiniPlayerRect}
 */
export function snapScrollMiniPlayerToEdge(rect, insets) {
  const dock = getDockFromRect(rect, insets)
  const left = dock === 'left'
    ? insets.left
    : window.innerWidth - insets.right - rect.width

  return { ...rect, left, dock }
}

/**
 * @param {number} t
 * @returns {number}
 */
function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * @param {ScrollMiniPlayerRect} from
 * @param {ScrollMiniPlayerRect} to
 * @param {(rect: ScrollMiniPlayerRect) => void} onUpdate
 * @param {() => void} [onComplete]
 * @returns {() => void}
 */
export function animateScrollMiniPlayerBounce(from, to, onUpdate, onComplete) {
  const start = performance.now()
  let rafId = 0

  const tick = (now) => {
    const elapsed = now - start
    const progress = Math.min(1, elapsed / BOUNCE_MS)
    const eased = easeOutBack(progress)

    onUpdate({
      ...from,
      left: from.left + (to.left - from.left) * eased,
      top: from.top + (to.top - from.top) * eased,
      dock: to.dock,
    })

    if (progress < 1) {
      rafId = requestAnimationFrame(tick)
    } else if (onComplete) {
      onComplete()
    }
  }

  rafId = requestAnimationFrame(tick)

  return () => {
    if (rafId) {
      cancelAnimationFrame(rafId)
    }
  }
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {{ left: number, right: number, top: number, bottom: number }} insets
 * @returns {'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'}
 */
export function getResizeHandleCorner(rect, insets) {
  const dock = getDockFromRect(rect, insets)
  const centerY = rect.top + rect.height / 2
  const inUpperHalf = centerY < window.innerHeight / 2

  if (dock === 'left') {
    return inUpperHalf ? 'bottom-right' : 'top-right'
  }

  return inUpperHalf ? 'bottom-left' : 'top-left'
}

/**
 * @param {ScrollMiniPlayerRect} rect
 * @param {'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'} corner
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {{ left: number, right: number, top: number, bottom: number }} insets
 * @returns {ScrollMiniPlayerRect}
 */
export function resizeScrollMiniPlayerFromCorner(rect, corner, pointerX, pointerY, insets) {
  const dock = getDockFromRect(rect, insets)
  const maxWidth = Math.min(MAX_WIDTH, window.innerWidth - insets.left - insets.right)
  const maxHeight = Math.min(MAX_HEIGHT, window.innerHeight - insets.top - insets.bottom)

  let width
  if (corner.endsWith('right')) {
    width = pointerX - rect.left
  } else {
    width = rect.left + rect.width - pointerX
  }

  width = Math.min(Math.max(width, MIN_WIDTH), maxWidth)
  let height = Math.round(width * 9 / 16)

  if (height > maxHeight) {
    height = maxHeight
    width = Math.round(height * 16 / 9)
  }

  const left = dock === 'left' ? insets.left : window.innerWidth - insets.right - width
  let top

  if (corner.startsWith('top')) {
    top = rect.top + rect.height - height
  } else {
    top = rect.top
  }

  const clamped = clampScrollMiniPlayerRect({ left, top, width, height, dock })
  return { ...clamped, dock }
}

/**
 * @param {HTMLElement | null | undefined} track
 * @param {number} percent
 */
export function updateScrollMiniPlayerVolumeBarFill(track, percent) {
  if (!track) return

  const clampedPercent = Math.max(0, Math.min(100, percent))
  track.style.background = `linear-gradient(to right, var(--primary-color) ${clampedPercent}%, rgba(255, 255, 255, 0.3) ${clampedPercent}%, rgba(255, 255, 255, 0.3) 100%)`
}

/** @type {HTMLCanvasElement | null} */
let scrollMiniDragHandleSampleCanvas = null

const SCROLL_MINI_DRAG_HANDLE_WIDTH = 72
const SCROLL_MINI_DRAG_HANDLE_HEIGHT = 28

function getScrollMiniDragHandleSampleCanvas() {
  if (!scrollMiniDragHandleSampleCanvas) {
    scrollMiniDragHandleSampleCanvas = document.createElement('canvas')
    scrollMiniDragHandleSampleCanvas.width = 9
    scrollMiniDragHandleSampleCanvas.height = 3
  }

  return scrollMiniDragHandleSampleCanvas
}

/**
 * @param {HTMLVideoElement | null | undefined} videoElement
 * @param {number} [displayWidth]
 * @param {number} [displayHeight]
 * @returns {number | null}
 */
export function sampleScrollMiniDragHandleLuminance(videoElement, displayWidth, displayHeight) {
  if (!videoElement || videoElement.readyState < 2) return null

  const videoWidth = videoElement.videoWidth
  const videoHeight = videoElement.videoHeight
  if (!videoWidth || !videoHeight) return null

  const resolvedDisplayWidth = displayWidth > 0 ? displayWidth : videoElement.clientWidth
  const resolvedDisplayHeight = displayHeight > 0 ? displayHeight : videoElement.clientHeight
  if (!resolvedDisplayWidth || !resolvedDisplayHeight) return null

  const scale = Math.min(resolvedDisplayWidth / videoWidth, resolvedDisplayHeight / videoHeight)
  const renderedWidth = videoWidth * scale
  const renderedHeight = videoHeight * scale
  const offsetX = (resolvedDisplayWidth - renderedWidth) / 2
  const offsetY = (resolvedDisplayHeight - renderedHeight) / 2

  const handleLeft = resolvedDisplayWidth / 2 - SCROLL_MINI_DRAG_HANDLE_WIDTH / 2
  const handleTop = 0

  const contentLeft = offsetX
  const contentTop = offsetY
  const contentRight = offsetX + renderedWidth
  const contentBottom = offsetY + renderedHeight

  const sampleLeft = Math.max(handleLeft, contentLeft)
  const sampleTop = Math.max(handleTop, contentTop)
  const sampleRight = Math.min(handleLeft + SCROLL_MINI_DRAG_HANDLE_WIDTH, contentRight)
  const sampleBottom = Math.min(handleTop + SCROLL_MINI_DRAG_HANDLE_HEIGHT, contentBottom)

  if (sampleRight <= sampleLeft || sampleBottom <= sampleTop) {
    return 0
  }

  const sx = (sampleLeft - offsetX) / scale
  const sy = (sampleTop - offsetY) / scale
  const sw = (sampleRight - sampleLeft) / scale
  const sh = (sampleBottom - sampleTop) / scale

  const canvas = getScrollMiniDragHandleSampleCanvas()
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(
      videoElement,
      sx, sy, sw, sh,
      0, 0, canvas.width, canvas.height
    )

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let total = 0
    let count = 0

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha === 0) continue

      total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      count++
    }

    return count > 0 ? total / count : null
  } catch {
    return null
  }
}

/**
 * @param {number} luminance
 * @param {boolean} [previous]
 * @returns {boolean}
 */
export function resolveScrollMiniDragHandleOnLightBg(luminance, previous = false) {
  if (luminance >= 150) return true
  if (luminance <= 105) return false
  return previous
}
