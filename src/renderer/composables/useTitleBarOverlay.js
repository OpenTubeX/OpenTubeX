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

/**
 * Finds the bar the window controls overlay is drawn over: the top tab bar,
 * the top navigation, or a vertical tab column.
 * @returns {Element | null}
 */
function findBarUnderControls() {
  const controls = navigator.windowControlsOverlay
  const titleBarArea = controls.getTitlebarAreaRect()
  if (!controls.visible || titleBarArea.height === 0) return null

  // The title bar area is the space beside the controls.
  const x = titleBarArea.left > 0 ? titleBarArea.left / 2 : (titleBarArea.right + innerWidth) / 2
  return document.elementsFromPoint(x, titleBarArea.height / 2)
    .find(element => element.matches('.tabBar, .topNav')) ?? null
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

  function sync() {
    frame = 0
    const bar = findBarUnderControls()
    if (bar !== observedBar) {
      observedBar = bar
      observeBar()
    }
    if (!bar) return

    const color = flattenColors(context, [
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(bar).backgroundColor
    ])
    const overlay = {
      color,
      symbolColor: calculateColorLuminance(color),
      // The top navigation and vertical tabs are taller than a title bar, so
      // the controls in their corner keep the tab bar's height.
      height: bar.matches('.tabBar.position-top') ? bar.getBoundingClientRect().height : 32
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
    if (observedBar) observer.observe(observedBar, { attributes: true, attributeFilter: ['class', 'style'] })
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
    scheduleSync()
  })

  onUnmounted(() => {
    observer?.disconnect()
    window.removeEventListener('resize', scheduleSync)
    navigator.windowControlsOverlay.removeEventListener('geometrychange', scheduleSync)
    document.removeEventListener('transitionend', handleTransitionEnd)
    if (frame !== 0) cancelAnimationFrame(frame)
  })
}
