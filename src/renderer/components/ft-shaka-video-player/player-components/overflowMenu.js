import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'

/**
 * Recalculates the Shaka overflow menu's scroll range after a row is hidden.
 *
 * @param {HTMLElement} menu
 */
export function scheduleOverflowMenuScrollClamp(menu) {
  requestAnimationFrame(() => {
    if (!menu.isConnected) {
      return
    }

    const visibleButtons = [...menu.children].filter(element => (
      element instanceof HTMLButtonElement && !element.classList.contains('shaka-hidden')
    ))
    clampOverlayScrollTop(menu, visibleButtons.at(-1) ?? null)
  })
}
