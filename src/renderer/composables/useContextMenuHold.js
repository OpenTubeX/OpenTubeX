import { onBeforeUnmount } from 'vue'

/** Share touch hold cancellation and click suppression between result cards. */
export function useContextMenuHold(openMenu) {
  let timer = null
  let position = null

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
    if (event.pointerType !== 'touch' || !event.isPrimary || event.target.closest('button, .channelName, [role="dialog"], [role="menu"], .iconDropdown')) return
    position = { x: event.clientX, y: event.clientY }
    timer = setTimeout(() => openMenu(event), 500)
  }

  function moveMenuHold(event) {
    if (position && Math.hypot(event.clientX - position.x, event.clientY - position.y) > 10) cancelMenuHold()
  }

  onBeforeUnmount(resetMenuHold)
  return { startMenuHold, moveMenuHold, cancelMenuHold, suppressMenuHoldClick }
}
