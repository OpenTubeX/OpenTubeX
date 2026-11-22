import { onBeforeUnmount } from 'vue'

/** Share touch hold cancellation and click suppression between result cards. */
export function useContextMenuHold(openMenu) {
  let timer = null
  let position = null
  let pointerType = null

  function cancelMenuHold() {
    clearTimeout(timer)
    timer = null
    position = null
  }

  function resetMenuHold() {
    cancelMenuHold()
    document.removeEventListener('click', suppressClick, true)
    document.removeEventListener('pointerdown', resetMenuHold, true)
    document.removeEventListener('keydown', resetMenuHold, true)
  }

  function suppressClick(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
    resetMenuHold()
  }

  function suppressMenuHoldClick() {
    cancelMenuHold()
    document.addEventListener('click', suppressClick, true)
    document.addEventListener('pointerdown', resetMenuHold, true)
    document.addEventListener('keydown', resetMenuHold, true)
  }

  function startMenuHold(event) {
    cancelMenuHold()
    pointerType = event.pointerType
    if (event.pointerType !== 'touch' || !event.isPrimary || event.currentTarget.contains(event.target.closest('button, .channelName, [role="dialog"], [role="menu"], .iconDropdown'))) return
    position = { x: event.clientX, y: event.clientY }
    timer = setTimeout(() => openMenu(event), 500)
  }

  function moveMenuHold(event) {
    if (position && Math.hypot(event.clientX - position.x, event.clientY - position.y) > 10) cancelMenuHold()
  }

  // Android starts dragging a held link before the hold opens the menu, and
  // the drag preview then follows the finger over the menu.
  function handleMenuHoldDragStart(event) {
    if (pointerType === 'touch') {
      event.preventDefault()
    } else {
      cancelMenuHold()
    }
  }

  onBeforeUnmount(resetMenuHold)
  return { startMenuHold, moveMenuHold, cancelMenuHold, handleMenuHoldDragStart, suppressMenuHoldClick }
}
