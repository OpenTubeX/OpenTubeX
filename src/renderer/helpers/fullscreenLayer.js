// Android's rotation fullscreen shows the watch layout as a popover in the top
// layer instead of making it the fullscreen element. The player sets the
// attribute only while that popover covers the window.
const ROTATION_FULLSCREEN_SELECTOR = '.videoLayout[popover]'

/**
 * The element that covers the window in fullscreen, which overlays must render
 * inside to show above it.
 * @returns {Element | null}
 */
export function getFullscreenLayer() {
  return document.fullscreenElement ?? document.querySelector(ROTATION_FULLSCREEN_SELECTOR)
}

/**
 * Calls `callback` after the element `getFullscreenLayer` returns may have
 * changed, with a `fullscreenchange` or, for rotation fullscreen, `toggle` event.
 * @param {(event: Event) => void} callback
 * @returns {() => void} Removes the listeners
 */
export function onFullscreenLayerChange(callback) {
  // Popovers fire toggle without bubbling, so listen while it captures.
  /** @param {Event} event */
  const handleToggle = (event) => {
    if (event.target instanceof Element && event.target.matches('.videoLayout')) callback(event)
  }
  document.addEventListener('fullscreenchange', callback)
  document.addEventListener('toggle', handleToggle, true)
  return () => {
    document.removeEventListener('fullscreenchange', callback)
    document.removeEventListener('toggle', handleToggle, true)
  }
}
