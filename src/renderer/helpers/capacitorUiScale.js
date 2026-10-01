export const CAPACITOR_UI_SCALE_MIN = 75
export const CAPACITOR_UI_SCALE_MAX = 150

/**
 * Resize the layout viewport along with its visual scale, so responsive layouts
 * and native video bounds use the same CSS coordinates. CSS zoom alone leaves
 * media queries and window.innerWidth at the unscaled size.
 */
export function createCapacitorUiScale(window, document) {
  const viewport = document.querySelector('meta[name="viewport"]')
  let scale = 100
  let lastContent = ''
  let androidPictureInPicture = false
  let androidReturnWidth = null
  let androidPipWindowWidth = null

  function apply() {
    if (!viewport || !window.visualViewport) return
    if (androidReturnWidth !== null && window.outerWidth !== androidPipWindowWidth) {
      androidReturnWidth = null
    }
    if (androidPictureInPicture || document.body?.classList.contains('androidPictureInPicture')) {
      // Android scales the live native view, keeping Chromium's viewport and
      // video surface unchanged throughout entry and subsequent PiP resizing.
      return
    }
    // WebKit can retain a stale visualViewport.scale after PiP returns while
    // reporting an unscaled width. The window width stays independent of zoom.
    const windowWidth = androidReturnWidth ?? window.outerWidth
    const baseWidth = Math.round(Number.isFinite(windowWidth) && windowWidth > 0
      ? windowWidth
      : window.visualViewport.width * window.visualViewport.scale)
    if (baseWidth <= 0) return
    const width = Math.max(1, Math.round(baseWidth * 100 / scale))
    const zoom = baseWidth / width
    const content = `width=${width}, initial-scale=${zoom}, viewport-fit=cover`
    if (content === lastContent) return
    lastContent = content
    document.documentElement.style.setProperty('--capacitor-ui-scale', String(zoom))
    viewport.setAttribute('content', content)
  }

  window.addEventListener('resize', apply)
  window.visualViewport?.addEventListener('resize', apply)
  const onAndroidPictureInPicture = event => {
    if (androidPictureInPicture && !event.active && Number.isFinite(event.windowWidth) && event.windowWidth > 0 &&
        Math.abs(window.outerWidth - event.windowWidth) > 1) {
      androidReturnWidth = event.windowWidth
      androidPipWindowWidth = window.outerWidth
    } else if (event.active || Math.abs(window.outerWidth - event.windowWidth) <= 1) {
      androidReturnWidth = null
    }
    androidPictureInPicture = event.active === true
    // App restores the body class in another listener for this same event.
    queueMicrotask(apply)
  }
  window.addEventListener('opentubex:android-pip', onAndroidPictureInPicture)

  return {
    setScale(value) {
      scale = Number.isFinite(value)
        ? Math.min(CAPACITOR_UI_SCALE_MAX, Math.max(CAPACITOR_UI_SCALE_MIN, value))
        : 100
      apply()
    },
    dispose() {
      window.removeEventListener('resize', apply)
      window.visualViewport?.removeEventListener('resize', apply)
      window.removeEventListener('opentubex:android-pip', onAndroidPictureInPicture)
    },
  }
}
