import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'

/**
 * Recalculates the Shaka overflow menu's scroll range after a row is hidden.
 *
 * @param {HTMLElement} menu
 * @param {HTMLElement | null} [contentElement] Last rendered item when the content lives in a submenu.
 */
export function scheduleOverflowMenuScrollClamp(menu, contentElement = null) {
  requestAnimationFrame(() => {
    if (!menu.isConnected) {
      return
    }

    const visibleButtons = [...menu.children].filter(element => (
      element instanceof HTMLButtonElement && !element.classList.contains('shaka-hidden')
    ))
    clampOverlayScrollTop(menu, contentElement ?? visibleButtons.at(-1) ?? null)
  })
}
