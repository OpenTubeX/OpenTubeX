import { PHONE_LAYOUT_QUERY } from '../composables/usePhoneLayout'

export const OPEN_MOBILE_CONTEXT_MENU_EVENT = 'opentubex:mobile-context-menu'

/** Phones and the mobile apps show menus as bottom sheets instead of popovers. */
export function usesMobileContextSheet() {
  return process.env.IS_CAPACITOR || window.matchMedia(PHONE_LAYOUT_QUERY).matches
}

/**
 * Opens the bottom sheet that phones use for context menus.
 * @param {{ title: string, actions: object[] | import('vue').Ref<object[]>, trigger?: HTMLElement }} menu
 *   `trigger` is the button that gets focus back when the sheet closes.
 */
export function openMobileContextMenu(menu) {
  window.dispatchEvent(new CustomEvent(OPEN_MOBILE_CONTEXT_MENU_EVENT, { detail: menu }))
}

/**
 * Opens the app menu below a menu button, or as a bottom sheet on phones and
 * in the mobile apps. Its rows grow to touch size on coarse pointers.
 * @param {HTMLElement} button
 * @param {import('vue').Ref<object[]>} items
 * @param {string} title The bottom sheet's heading
 */
export function openButtonMenu(button, items, title) {
  if (usesMobileContextSheet()) {
    openMobileContextMenu({ title, actions: items, trigger: button })
    return
  }
  button.focus({ preventScroll: true })
  const bounds = button.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent('opentubex:context-menu', {
    detail: { x: document.body.dir === 'rtl' ? bounds.right : bounds.left, y: bounds.bottom, items, touchFriendly: true }
  }))
}
