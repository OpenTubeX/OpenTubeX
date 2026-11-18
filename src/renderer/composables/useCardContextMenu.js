import { inject, onBeforeUnmount } from 'vue'

import { openButtonMenu } from '../helpers/buttonMenu'
import { lightHaptic } from '../helpers/mobileHaptics'
import { useContextMenuHold } from './useContextMenuHold'

/**
 * Opens a result card's menu from a right click, a touch hold, the menu key
 * and its options button.
 * @param {{
 *   items: import('vue').Ref<object[]>,
 *   title: () => string,
 *   thumbnailActions?: import('vue').Ref<object[]>,
 *   beforeOpen?: () => void,
 * }} menu `thumbnailActions` lead the bottom sheet on phones. `beforeOpen`
 *   stops gestures, like a thumbnail swipe, that the menu replaces.
 */
export function useCardContextMenu({ items, title, thumbnailActions, beforeOpen }) {
  const openMobileContextActions = inject('openMobileContextActions')
  const hold = useContextMenuHold(openContextMenu)

  function openContextMenu(event) {
    beforeOpen?.()
    // Channel links, dialogs and dropdowns keep their own menus
    if (event.target.closest('a.channelName, [role="dialog"], [role="menu"], .iconDropdown')) return
    if (event.pointerType !== 'touch' && !process.env.IS_ELECTRON) {
      // Only Electron can merge native image and selection actions into our menu.
      const selection = window.getSelection()
      if (event.target.closest('img, video') || (selection && !selection.isCollapsed && selection.containsNode(event.target, true))) return
    }
    event.preventDefault()
    event.stopPropagation()
    hold.cancelMenuHold()
    if (event.pointerType === 'touch') {
      hold.suppressMenuHoldClick()
      openMobileContextActions({ title: title(), actions: items, thumbnailActions })
      lightHaptic()
      return
    }
    const bounds = event.target.getBoundingClientRect()
    const keyboard = event.type === 'keydown' || (event.clientX === 0 && event.clientY === 0)
    window.dispatchEvent(new CustomEvent('opentubex:context-menu', {
      detail: { x: keyboard ? bounds.left : event.clientX, y: keyboard ? bounds.bottom : event.clientY, items, contextEvent: event }
    }))
  }

  /** @param {HTMLElement} button */
  function openOptionsMenu(button) {
    hold.cancelMenuHold()
    openButtonMenu(button, items, title(), thumbnailActions)
  }

  /**
   * Opens the menu for the menu key and Shift+F10.
   * @param {KeyboardEvent} event
   * @returns {boolean} whether the key opens menus, so other shortcuts skip it
   */
  function handleMenuKeydown(event) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false
    openContextMenu(event)
    return true
  }

  onBeforeUnmount(() => {
    window.dispatchEvent(new CustomEvent('opentubex:close-context-menu', { detail: items }))
  })

  return { ...hold, openContextMenu, openOptionsMenu, handleMenuKeydown }
}
