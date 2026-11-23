/**
 * Initializes the document scrollbar for the current platform. Capacitor uses
 * Android's native page scrollbar, while desktop and web draw the themed
 * overlay scrollbar. Nested scroll containers are handled separately.
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
    return null
  }

  return createOverlayScrollbar(pageDocument.body)
}

/**
 * Android draws its page scrollbar outside CSS, even when fullscreen hides
 * document overflow. Keep it hidden for native fullscreen, full-window mode,
 * maximized settings, which draws its own nested scrollbar, and while a sheet
 * or dialog locks the page, whose root still scrolls when its content shrinks.
 * @param {Document} pageDocument
 * @param {(hidden: boolean) => void} setHidden
 * @returns {() => void}
 */
export function observePageScrollbarVisibility(pageDocument, setHidden) {
  let previousHidden
  const update = () => {
    const hidden = pageDocument.fullscreenElement !== null ||
      pageDocument.body.classList.contains('playerFullWindow') ||
      pageDocument.documentElement.classList.contains('appSettingsMaximized') ||
      pageDocument.documentElement.classList.contains('appScrollLocked')
    if (hidden === previousHidden) return
    previousHidden = hidden
    setHidden(hidden)
  }
  const observer = new pageDocument.defaultView.MutationObserver(update)
  observer.observe(pageDocument.body, { attributes: true, attributeFilter: ['class'] })
  observer.observe(pageDocument.documentElement, { attributes: true, attributeFilter: ['class'] })
  pageDocument.addEventListener('fullscreenchange', update)
  update()
  return () => {
    observer.disconnect()
    pageDocument.removeEventListener('fullscreenchange', update)
  }
}

/**
 * Reports where the page scrollbar starts, below the header and a pinned
 * Watch page player, for native page scrollbars that CSS can't place. A probe
 * resolves `--page-scrollbar-block-start`, so it follows every change to it.
 * @param {Document} pageDocument
 * @param {(blockStart: number) => void} setBlockStart CSS pixels from the top of the page
 * @returns {() => void}
 */
export function observePageScrollbarStart(pageDocument, setBlockStart) {
  const view = pageDocument.defaultView
  const probe = pageDocument.createElement('div')
  probe.className = 'pageScrollbarStartProbe'
  probe.setAttribute('aria-hidden', 'true')
  pageDocument.body.append(probe)
  const update = () => setBlockStart(probe.getBoundingClientRect().height)
  const observer = new view.ResizeObserver(update)
  observer.observe(probe)
  // UI Scale changes the device pixels per CSS pixel without resizing the probe.
  view.visualViewport?.addEventListener('resize', update)
  return () => {
    observer.disconnect()
    view.visualViewport?.removeEventListener('resize', update)
    probe.remove()
  }
}
