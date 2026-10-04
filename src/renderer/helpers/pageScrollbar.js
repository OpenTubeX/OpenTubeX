/**
 * Initializes the document scrollbar for the current platform. Capacitor uses
 * Android's native page scrollbar, while desktop and web keep the themed
 * OverlayScrollbars instance. Nested scroll containers are handled separately.
 *
 * @template T
 * @param {{ documentElement: HTMLElement, body: HTMLElement }} pageDocument
 * @param {boolean} useNativePageScrollbar
 * @param {(target: HTMLElement) => T} createOverlayScrollbar
 * @returns {T | null}
 */
export function initializePageScrollbar(
  pageDocument,
  useNativePageScrollbar,
  createOverlayScrollbar
) {
  if (useNativePageScrollbar) {
    pageDocument.documentElement.removeAttribute('data-overlayscrollbars-initialize')
    pageDocument.body.removeAttribute('data-overlayscrollbars-initialize')
    return null
  }

  return createOverlayScrollbar(pageDocument.body)
}

/**
 * Android draws its page scrollbar outside CSS, even when fullscreen hides
 * document overflow. Keep it hidden for native fullscreen and full-window mode.
 * @param {Document} pageDocument
 * @param {(hidden: boolean) => void} setHidden
 * @returns {() => void}
 */
export function observePageScrollbarVisibility(pageDocument, setHidden) {
  let previousHidden
  const update = () => {
    const hidden = pageDocument.fullscreenElement !== null || pageDocument.body.classList.contains('playerFullWindow')
    if (hidden === previousHidden) return
    previousHidden = hidden
    setHidden(hidden)
  }
  const observer = new pageDocument.defaultView.MutationObserver(update)
  observer.observe(pageDocument.body, { attributes: true, attributeFilter: ['class'] })
  pageDocument.addEventListener('fullscreenchange', update)
  update()
  return () => {
    observer.disconnect()
    pageDocument.removeEventListener('fullscreenchange', update)
  }
}
