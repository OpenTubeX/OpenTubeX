/**
 * Opens the app menu below a menu button. Its rows grow to touch size on
 * coarse pointers and in the mobile apps.
 * @param {HTMLElement} button
 * @param {import('vue').Ref<object[]>} items
 */
export function openButtonMenu(button, items) {
  button.focus({ preventScroll: true })
  const bounds = button.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent('opentubex:context-menu', {
    detail: { x: document.body.dir === 'rtl' ? bounds.right : bounds.left, y: bounds.bottom, items, touchFriendly: true }
  }))
}
