import { onBeforeUnmount } from 'vue'

/**
 * Teleport target for a modal overlay: the fullscreen element while one is
 * open, so the overlay shows above it, otherwise `.app`. Chromium exits
 * fullscreen on Escape before the page sees the key, which would leave the
 * overlay stranded inside the windowed element, so dismiss it then.
 * @param {() => void} dismiss
 * @returns {Element | string}
 */
export function useFullscreenTeleportTarget(dismiss) {
  const target = document.fullscreenElement
  if (!target) return '.app'

  const handleFullscreenChange = () => {
    if (document.fullscreenElement !== target) dismiss()
  }
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  onBeforeUnmount(() => document.removeEventListener('fullscreenchange', handleFullscreenChange))
  return target
}
