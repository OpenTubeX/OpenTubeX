import { onMounted, onUnmounted, watch } from 'vue'

import { calculateColorLuminance } from '../helpers/colors'

/**
 * Flattens CSS colors onto each other into the opaque hex color Electron
 * accepts for the window controls overlay. Themes may use translucent or
 * non-sRGB colors that it can't parse directly.
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} context
 * @param {string[]} colors bottom-most color first
 */
export function flattenColors(context, colors) {
  context.fillStyle = '#000000'
  context.fillRect(0, 0, 1, 1)
  for (const color of colors) {
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
  }
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

const TRANSPARENT = '#00000000'

/**
 * Finds what the window controls overlay is drawn over: the top tab bar, the
 * top navigation, a vertical tab column, or a full window player.
 * @returns {Element | null}
 */
function findBarUnderControls() {
  const controls = navigator.windowControlsOverlay
  const titleBarArea = controls.getTitlebarAreaRect()
  if (!controls.visible || titleBarArea.height === 0) return null

  // The title bar area is the space beside the controls.
  const x = titleBarArea.left > 0 ? titleBarArea.left / 2 : (titleBarArea.right + innerWidth) / 2
  return document.elementsFromPoint(x, titleBarArea.height / 2)
    .find(element => element.matches('.tabBar, .topNav, .ftVideoPlayer.fullWindow')) ?? null
}

/**
 * Keeps the native window controls blended into the bar the renderer draws
 * in place of the system title bar.
 * @param {import('vue').WatchSource} layout changes that can move the bar under the controls
 */
export function useTitleBarOverlay(layout) {
  // Linux draws its own controls. macOS only takes the height from this.
  if (!process.env.IS_ELECTRON || process.platform === 'linux' || !window.ftElectron.customTitleBar) return

  const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
  let frame = 0
  let lastOverlay = ''
  /** @type {MutationObserver | null} */
  let observer = null
  /** @type {Element | null} */
  let observedBar = null
  let barHeight = 32
  let pointerOnControls = false

  function sync() {
    frame = 0
    // A player entering full window covers the controls once it finishes
    // animating there.
    for (const animation of document.querySelector('.ftVideoPlayer.fullWindow')?.getAnimations() ?? []) {
      animation.finished.then(scheduleSync, () => {})
    }
    const bar = findBarUnderControls()
    if (bar !== observedBar) {
      observedBar = bar
      observeBar()
    }
    if (!bar) return

    let overlay
    if (bar.matches('.ftVideoPlayer')) {
      // The controls float over the video and show with the player's own.
      const shown = pointerOnControls || bar.getAttribute('data-player-controls-shown') === 'true'
      overlay = { color: TRANSPARENT, symbolColor: shown ? '#ffffff' : TRANSPARENT, height: barHeight }
    } else {
      const color = flattenColors(context, [
        getComputedStyle(document.body).backgroundColor,
        getComputedStyle(bar).backgroundColor
      ])
      overlay = {
        color,
        symbolColor: calculateColorLuminance(color),
        // The top navigation and vertical tabs are taller than a title bar, so
        // the controls in their corner keep the tab bar's height.
        height: bar.matches('.tabBar.position-top') ? bar.getBoundingClientRect().height : 32
      }
      barHeight = overlay.height
    }
    // The UI scale changes the overlay's size in device pixels.
    const serialized = JSON.stringify([overlay, window.devicePixelRatio])
    if (serialized === lastOverlay) return
    lastOverlay = serialized
    window.ftElectron.setTitleBarOverlay(overlay)
  }

  function scheduleSync() {
    if (frame === 0) frame = requestAnimationFrame(sync)
  }

  function observeBar() {
    if (!observer) return
    observer.disconnect()
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
    const app = document.querySelector('.app')
    if (app) observer.observe(app, { attributes: true, attributeFilter: ['class', 'style'] })
    if (observedBar) {
      observer.observe(observedBar, { attributes: true, attributeFilter: ['class', 'style', 'data-player-controls-shown'] })
    }
  }

  /**
   * Moving onto the window controls leaves the page, which hides the player's
   * controls, so the window's stay shown while the pointer is on them.
   * @param {MouseEvent} event
   */
  function handlePointerLeave(event) {
    const titleBarArea = navigator.windowControlsOverlay.getTitlebarAreaRect()
    pointerOnControls = event.clientY < titleBarArea.height &&
      (event.clientX < titleBarArea.left || event.clientX >= titleBarArea.right)
    scheduleSync()
  }

  function handlePointerEnter() {
    if (!pointerOnControls) return
    pointerOnControls = false
    scheduleSync()
  }

  /** @param {TransitionEvent} event */
  function handleTransitionEnd(event) {
    if (event.target === observedBar && event.propertyName === 'background-color') scheduleSync()
  }

  watch(layout, scheduleSync, { flush: 'post' })

  onMounted(() => {
    observer = new MutationObserver(scheduleSync)
    observeBar()
    window.addEventListener('resize', scheduleSync)
    navigator.windowControlsOverlay.addEventListener('geometrychange', scheduleSync)
    document.addEventListener('transitionend', handleTransitionEnd)
    document.documentElement.addEventListener('mouseleave', handlePointerLeave)
    document.documentElement.addEventListener('mouseenter', handlePointerEnter)
    scheduleSync()
  })

  onUnmounted(() => {
    observer?.disconnect()
    window.removeEventListener('resize', scheduleSync)
    navigator.windowControlsOverlay.removeEventListener('geometrychange', scheduleSync)
    document.removeEventListener('transitionend', handleTransitionEnd)
    document.documentElement.removeEventListener('mouseleave', handlePointerLeave)
    document.documentElement.removeEventListener('mouseenter', handlePointerEnter)
    if (frame !== 0) cancelAnimationFrame(frame)
  })
}
