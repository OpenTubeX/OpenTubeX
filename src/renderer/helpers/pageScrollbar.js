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
