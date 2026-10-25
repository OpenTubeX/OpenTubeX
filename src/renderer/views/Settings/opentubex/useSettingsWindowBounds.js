import { computed, nextTick, ref } from 'vue'

const IS_CAPACITOR = !!process.env.IS_CAPACITOR
export const SETTINGS_DESKTOP_WIDTH_THRESHOLD = 760
const SETTINGS_BOUNDS_STORAGE_KEY = 'opentubex-settings-window-bounds'
const WINDOW_MARGIN = 12
const MINIMUM_WIDTH = 360
const MINIMUM_HEIGHT = 360
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 820
export const RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

/**
 * Position and size of the floating settings window: dragging, resizing,
 * maximizing, keeping it inside the viewport and remembering its bounds.
 * Mobile and narrow viewports always show the window maximized.
 *
 * @param {import('vue').ShallowRef<HTMLElement | null>} settingsWindowRef
 */
export function useSettingsWindowBounds(settingsWindowRef) {
  const isMaximized = ref(false)
  const isNarrowLayout = ref(window.innerWidth < SETTINGS_DESKTOP_WIDTH_THRESHOLD)
  let boundsSaveTimer = null
  let boundsAnimation = null
  let draggingPointerId = null
  let resizeSession = null
  let dragOffsetX = 0
  let dragOffsetY = 0
  let draggedBounds = null
  let maximizedDragSession = null
  let restoreBounds = null

  const windowBounds = ref(getInitialBounds())
  const isMaximizationForced = computed(() => IS_CAPACITOR || isNarrowLayout.value)
  const isWindowMaximized = computed(() => isMaximized.value || isMaximizationForced.value)
  const windowStyle = computed(() => isWindowMaximized.value
    ? {
        left: '0',
        top: 'var(--app-safe-area-inset-top, 0px)',
        inlineSize: '100%',
        blockSize: 'calc(100dvh - var(--app-safe-area-inset-top, 0px))'
      }
    : {
        left: '0',
        top: '0',
        // Translation keeps movement separate from layout and bounds animations.
        translate: `${windowBounds.value.x}px ${windowBounds.value.y}px`,
        inlineSize: `${windowBounds.value.width}px`,
        blockSize: `${windowBounds.value.height}px`
      })

  async function toggleMaximized() {
    if (isMaximizationForced.value) return
    cancelBoundsAnimation()
    const element = settingsWindowRef.value
    const from = getWindowAnimationState(element)
    if (isMaximized.value) {
      restoreSettingsWindow()
    } else {
      restoreBounds = { ...windowBounds.value }
      isMaximized.value = true
    }
    await nextTick()
    animateWindowBounds(element, from)
  }

  function getWindowAnimationState(element) {
    if (!element) return null
    const bounds = element.getBoundingClientRect()
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      borderRadius: getComputedStyle(element).borderRadius
    }
  }

  // The window is already at its target bounds here, so the difference is played back
  // with transforms only. Animating left/top/width/height instead would relayout the
  // whole settings page and re-evaluate its container queries on every single frame.
  function animateWindowBounds(element, from) {
    if (!element || !from || document.documentElement.dataset.reducedMotion === 'reduce') return
    const to = getWindowAnimationState(element)
    if (to.width === 0 || to.height === 0) return
    const animation = element.animate([
      {
        transformOrigin: '0 0',
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        borderRadius: from.borderRadius
      },
      {
        transformOrigin: '0 0',
        transform: 'none',
        borderRadius: to.borderRadius
      }
    ], {
      duration: 240,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    })
    boundsAnimation = animation
    animation.finished.catch(() => {}).finally(() => {
      if (boundsAnimation === animation) boundsAnimation = null
    })
  }

  function cancelBoundsAnimation() {
    boundsAnimation?.cancel()
    boundsAnimation = null
  }

  function restoreSettingsWindow() {
    if (!isMaximized.value) return
    windowBounds.value = clampBounds(restoreBounds ?? windowBounds.value)
    restoreBounds = null
    isMaximized.value = false
    scheduleBoundsSave()
  }

  function handleHeaderDoubleClick(event) {
    if (
      isMaximizationForced.value ||
      event.button !== 0 ||
      event.target.closest('button, input, .settingsSearch')
    ) return
    toggleMaximized()
  }

  function startDragging(event) {
    if (
      isMaximizationForced.value ||
      event.button !== 0 ||
      event.target.closest('button, input, .settingsSearch')
    ) return
    cancelBoundsAnimation()
    const renderedBounds = settingsWindowRef.value.getBoundingClientRect()
    if (isMaximized.value) {
      const floatingBounds = clampBounds(restoreBounds ?? windowBounds.value)
      maximizedDragSession = {
        floatingBounds,
        horizontalPosition: renderedBounds.width > 0
          ? (event.clientX - renderedBounds.left) / renderedBounds.width
          : 0.5,
        pointerOffsetY: event.clientY - renderedBounds.top
      }
    } else {
      const bounds = windowBounds.value
      dragOffsetX = event.clientX - bounds.x
      dragOffsetY = event.clientY - bounds.y
    }
    draggingPointerId = event.pointerId
    document.documentElement.classList.add('draggingSettingsWindow')
    window.addEventListener('pointermove', dragWindow)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
    event.preventDefault()
  }

  function dragWindow(event) {
    if (event.pointerId !== draggingPointerId) return
    if (maximizedDragSession !== null) {
      const { floatingBounds, horizontalPosition, pointerOffsetY } = maximizedDragSession
      windowBounds.value = clampBounds({
        ...floatingBounds,
        x: event.clientX - floatingBounds.width * horizontalPosition,
        y: event.clientY - pointerOffsetY
      })
      dragOffsetX = event.clientX - windowBounds.value.x
      dragOffsetY = event.clientY - windowBounds.value.y
      maximizedDragSession = null
      restoreBounds = null
      isMaximized.value = false
      return
    }
    draggedBounds = clampBounds({
      ...windowBounds.value,
      x: event.clientX - dragOffsetX,
      y: event.clientY - dragOffsetY
    })
    // Updating reactive bounds here also rerenders the settings controls and their
    // scrollbar directives. Only commit the final bounds when the drag stops.
    settingsWindowRef.value.style.translate = `${draggedBounds.x}px ${draggedBounds.y}px`
  }

  function stopDragging(event) {
    if (event && event.pointerId !== draggingPointerId) return
    if (draggingPointerId === null) return
    if (draggedBounds !== null) {
      windowBounds.value = draggedBounds
      draggedBounds = null
    }
    draggingPointerId = null
    maximizedDragSession = null
    document.documentElement.classList.remove('draggingSettingsWindow')
    window.removeEventListener('pointermove', dragWindow)
    window.removeEventListener('pointerup', stopDragging)
    window.removeEventListener('pointercancel', stopDragging)
    scheduleBoundsSave()
  }

  function startResizing(event, direction) {
    if (event.button !== 0 || isWindowMaximized.value) return
    cancelBoundsAnimation()
    resizeSession = {
      direction,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      bounds: { ...windowBounds.value }
    }
    document.documentElement.classList.add('resizingSettingsWindow')
    document.documentElement.style.cursor = getComputedStyle(event.currentTarget).cursor
    window.addEventListener('pointermove', resizeWindow)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    event.preventDefault()
    event.stopPropagation()
  }

  function resizeWindow(event) {
    if (resizeSession === null || event.pointerId !== resizeSession.pointerId) return
    const { direction, startX, startY, bounds } = resizeSession
    const deltaX = event.clientX - startX
    const deltaY = event.clientY - startY
    let left = bounds.x
    let right = bounds.x + bounds.width
    let top = bounds.y
    let bottom = bounds.y + bounds.height

    if (direction.includes('e')) right += deltaX
    if (direction.includes('w')) left += deltaX
    if (direction.includes('s')) bottom += deltaY
    if (direction.includes('n')) top += deltaY

    const maximumRight = window.innerWidth - WINDOW_MARGIN
    const maximumBottom = window.innerHeight - WINDOW_MARGIN
    const minimumWidth = Math.min(MINIMUM_WIDTH, maximumRight - WINDOW_MARGIN)
    const minimumHeight = Math.min(MINIMUM_HEIGHT, maximumBottom - WINDOW_MARGIN)
    left = Math.max(WINDOW_MARGIN, left)
    top = Math.max(WINDOW_MARGIN, top)
    right = Math.min(maximumRight, right)
    bottom = Math.min(maximumBottom, bottom)

    if (right - left < minimumWidth) {
      if (direction.includes('w')) left = Math.max(WINDOW_MARGIN, right - minimumWidth)
      else right = Math.min(maximumRight, left + minimumWidth)
    }
    if (bottom - top < minimumHeight) {
      if (direction.includes('n')) top = Math.max(WINDOW_MARGIN, bottom - minimumHeight)
      else bottom = Math.min(maximumBottom, top + minimumHeight)
    }

    windowBounds.value = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    }
  }

  function stopResizing(event) {
    if (resizeSession === null || (event && event.pointerId !== resizeSession.pointerId)) return
    resizeSession = null
    document.documentElement.classList.remove('resizingSettingsWindow')
    document.documentElement.style.removeProperty('cursor')
    window.removeEventListener('pointermove', resizeWindow)
    window.removeEventListener('pointerup', stopResizing)
    window.removeEventListener('pointercancel', stopResizing)
    scheduleBoundsSave()
  }

  function handleViewportResize() {
    updateNarrowLayout()
    if (isMaximizationForced.value) stopDragging()
    clampWindowToViewport()
  }

  function updateNarrowLayout() {
    isNarrowLayout.value = window.innerWidth < SETTINGS_DESKTOP_WIDTH_THRESHOLD
  }

  function clampWindowToViewport() {
    if (isWindowMaximized.value) return
    windowBounds.value = clampBounds(draggedBounds ?? windowBounds.value)
    if (draggedBounds !== null) draggedBounds = windowBounds.value
  }

  function clampBounds(bounds) {
    const maximumWidth = Math.max(0, window.innerWidth - WINDOW_MARGIN * 2)
    const maximumHeight = Math.max(0, window.innerHeight - WINDOW_MARGIN * 2)
    const width = Math.min(Math.max(bounds.width, MINIMUM_WIDTH), maximumWidth)
    const height = Math.min(Math.max(bounds.height, MINIMUM_HEIGHT), maximumHeight)
    return {
      x: Math.min(Math.max(bounds.x, WINDOW_MARGIN), window.innerWidth - width - WINDOW_MARGIN),
      y: Math.min(Math.max(bounds.y, WINDOW_MARGIN), window.innerHeight - height - WINDOW_MARGIN),
      width,
      height
    }
  }

  function getInitialBounds() {
    const fallbackWidth = Math.min(DEFAULT_WIDTH, Math.max(MINIMUM_WIDTH, window.innerWidth - 48))
    const fallbackHeight = Math.min(DEFAULT_HEIGHT, Math.max(MINIMUM_HEIGHT, window.innerHeight - 80))
    const fallback = {
      x: Math.round((window.innerWidth - fallbackWidth) / 2),
      y: Math.max(WINDOW_MARGIN, Math.round((window.innerHeight - fallbackHeight) / 2)),
      width: fallbackWidth,
      height: fallbackHeight
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_BOUNDS_STORAGE_KEY))
      if ([saved?.x, saved?.y, saved?.width, saved?.height].every(Number.isFinite)) {
        return clampBounds(saved)
      }
    } catch {
      // Ignore corrupt state and use the centered default.
    }
    return clampBounds(fallback)
  }

  function scheduleBoundsSave() {
    if (boundsSaveTimer !== null) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_BOUNDS_STORAGE_KEY, JSON.stringify(windowBounds.value))
      } catch {
        // Bounds are convenience state; storage can be unavailable or full.
      } finally {
        boundsSaveTimer = null
      }
    }, 150)
  }

  /**
   * Adopts the rendered size unless the window is maximized or a gesture or
   * animation currently owns its bounds.
   * @param {HTMLElement} element
   */
  function syncRenderedWindowBounds(element) {
    if (
      !isWindowMaximized.value &&
      boundsAnimation === null &&
      draggingPointerId === null &&
      resizeSession === null
    ) {
      windowBounds.value = clampBounds({
        ...windowBounds.value,
        width: element.offsetWidth,
        height: element.offsetHeight
      })
      scheduleBoundsSave()
    }
  }

  function disposeWindowBounds() {
    if (boundsSaveTimer !== null) {
      clearTimeout(boundsSaveTimer)
    }
    boundsAnimation?.cancel()
  }

  return {
    isMaximized,
    isNarrowLayout,
    windowBounds,
    isMaximizationForced,
    isWindowMaximized,
    windowStyle,
    toggleMaximized,
    handleHeaderDoubleClick,
    startDragging,
    stopDragging,
    startResizing,
    stopResizing,
    handleViewportResize,
    updateNarrowLayout,
    syncRenderedWindowBounds,
    disposeWindowBounds
  }
}
