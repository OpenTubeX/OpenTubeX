import { nextTick, onBeforeUnmount, shallowRef } from 'vue'

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

  // Entering fullscreen can blur the focused element before fullscreenchange.
  let blurred = null
  /** @param {FocusEvent} event */
  const handleFocusChange = (event) => {
    blurred = event.type === 'focusout' && !event.relatedTarget ? event.target : null
  }

  /** @param {Element | string} value */
  const moveTo = (value) => {
    // Moving the overlay's nodes drops focus from them, so restore it.
    const focused = document.activeElement === document.body ? blurred : document.activeElement
    target.value = value
    nextTick(() => {
      const container = typeof value === 'string' ? document.querySelector(value) : value
      if (focused instanceof HTMLElement && container?.contains(focused) && document.activeElement === document.body) {
        focused.focus()
      }
    })
  }

  let timeout
  const handleFullscreenChange = () => {
    if (document.fullscreenElement) {
      moveTo(document.fullscreenElement)
      return
    }
    if (target.value === '.app') return
    // Vue re-renders between listeners, so decide before any overlay moves or
    // closes, as either changes which overlay is topmost for the others.
    const keep = keepOpen()
    timeout = setTimeout(() => {
      if (keep) moveTo('.app')
      else dismiss()
    })
  }
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('focusin', handleFocusChange)
  document.addEventListener('focusout', handleFocusChange)
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
    document.removeEventListener('focusin', handleFocusChange)
    document.removeEventListener('focusout', handleFocusChange)
    clearTimeout(timeout)
  })
  return target
}
