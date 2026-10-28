import { onBeforeUnmount, shallowRef } from 'vue'

/**
 * Teleport target for a modal overlay: the fullscreen element while one is
 * open, so the overlay shows above it, otherwise `.app`. Chromium exits
 * fullscreen on Escape before the page sees the key, which would leave the
 * overlay stranded inside the windowed element, so dismiss it then. Overlays
 * waiting behind another one move to `.app` instead, as Escape only closes the
 * topmost overlay.
 * @param {() => void} dismiss
 * @param {() => boolean} [keepOpen]
 */
export function useFullscreenTeleportTarget(dismiss, keepOpen = () => false) {
  /** @type {import('vue').ShallowRef<Element | string>} */
  const target = shallowRef(document.fullscreenElement ?? '.app')

  let timeout
  const handleFullscreenChange = () => {
    if (document.fullscreenElement) {
      target.value = document.fullscreenElement
      return
    }
    if (target.value === '.app') return
    // Vue re-renders between listeners, so decide before any overlay moves or
    // closes, as either changes which overlay is topmost for the others.
    const keep = keepOpen()
    timeout = setTimeout(() => {
      if (keep) target.value = '.app'
      else dismiss()
    })
  }
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
    clearTimeout(timeout)
  })
  return target
}
